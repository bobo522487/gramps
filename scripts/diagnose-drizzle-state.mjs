#!/usr/bin/env node
/**
 * 生产库迁移卡点诊断：drizzle-kit 自己的记录表与 schema。
 *
 * 2026-11-09：基线的 97 条语句单独跑都能过（diagnose-migration.mjs 验证），
 * 但 `drizzle-kit migrate` 仍失败。差别只可能在 drizzle 自己那套东西上：
 * `drizzle` schema、`drizzle.__drizzle_migrations` 表、以及它记录 hash 的方式。
 * 本脚本只读，把这几样打印出来。
 */

import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

try {
  const [db] =
    await sql`select current_database() as name, current_user as usr`;
  console.log(`# 库 ${db.name} · 角色 ${db.usr}`);

  const schemas = await sql`
    select nspname from pg_namespace
    where nspname not like 'pg_%' and nspname <> 'information_schema'
    order by 1
  `;
  console.log(`schema: ${schemas.map((s) => s.nspname).join(', ')}`);

  const objects = await sql`
    select n.nspname, c.relname, c.relkind
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth', 'app', 'drizzle')
      and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
    order by 1, 2
  `;
  console.log(`受管 schema 内对象数: ${objects.length}`);
  for (const o of objects.slice(0, 40)) {
    console.log(`  - ${o.nspname}.${o.relname} (${o.relkind})`);
  }

  const rel = await sql`
    select to_regclass('drizzle.__drizzle_migrations') as tbl
  `;
  if (rel[0]?.tbl) {
    const rows = await sql`
      select id, hash, created_at from drizzle.__drizzle_migrations order by id
    `;
    console.log(`drizzle.__drizzle_migrations 行数: ${rows.length}`);
    for (const r of rows) console.log(`  - id=${r.id} hash=${r.hash}`);
  } else {
    console.log('drizzle.__drizzle_migrations 不存在');
  }

  const roles = await sql`
    select rolname, rolcanlogin, rolsuper, rolcreaterole,
           (select string_agg(m.rolname, ',' order by m.rolname)
              from pg_auth_members am join pg_roles m on m.oid = am.member
             where am.roleid = pg_roles.oid) as has_members
    from pg_roles
    where rolname in ('genealogy_app', 'auth_service', 'auth_runtime')
    order by 1
  `;
  console.log(
    `角色: ${roles.map((r) => `${r.rolname}(login=${r.rolcanlogin})`).join(', ') || '（无）'}`
  );

  // ALTER ROLE 的权限模型：执行者是目标角色的成员，或拥有 CREATEROLE / 超级用户。
  // PG 的角色**没有「属主」概念**，`pg_roles` 里没有 rolowner 列——只有「谁创建的」，
  // 那是审计信息，不决定权限。Neon 上这些角色可能由控制面角色创建，迁移连接
  // 不在其成员里，alter role 就是 42501。
  const [me] = await sql`
    select current_user as usr,
           (select rolcreaterole from pg_roles where rolname = current_user) as createrole,
           (select rolsuper from pg_roles where rolname = current_user) as super
  `;
  console.log(
    `当前角色 ${me.usr}: ${me.super ? 'SUPERUSER' : '普通'}${me.createrole ? ' +CREATEROLE' : ''}`
  );
  for (const r of roles) {
    const [isMember] = await sql`
      select pg_has_role(current_user, ${r.rolname}, 'MEMBER') as ok`;
    const can = me.super || me.createrole || isMember.ok;
    console.log(
      `  → ALTER ${r.rolname}: ${can ? '可' : '不可（需该组成员或 CREATEROLE）'}`
    );
  }

  // 上面只是「理论权限」。Neon 的实际行为未必一致：2026-11-09 的诊断显示
  // neondb_owner 带 CREATEROLE、对三个角色都判「可」，可真正 alter 仍 42501。
  // 所以逐条在 savepoint 里真跑一次，把能过和不能过的分开列出。
  // 只跑无副作用或可回滚的语句，整个包在一个事务里最后 rollback。
  console.log('--- ALTER 实测（事务内回滚，不改库）---');
  const probes = [
    ['genealogy_app', 'alter role genealogy_app login nosuperuser nobypassrls'],
    ['auth_service', 'alter role auth_service nologin nosuperuser nobypassrls'],
    ['auth_runtime', 'alter role auth_runtime login nosuperuser nobypassrls'],
  ];
  try {
    await sql.begin(async (tx) => {
      for (const [role, stmt] of probes) {
        await tx.unsafe('savepoint p');
        try {
          await tx.unsafe(stmt);
          await tx.unsafe('release savepoint p');
          console.log(`  ✓ ${role} 属性可改`);
        } catch (e) {
          await tx.unsafe('rollback to savepoint p');
          console.log(`  ✗ ${role} 属性不可改 → ${e.code ?? '?'} ${e.message}`);
        }
      }
      // 口令单独试：有的托管库允许改属性但禁止改口令。
      await tx.unsafe('savepoint q');
      try {
        await tx.unsafe(
          "alter role genealogy_app password 'Probe-Temp!9xQz#2026'"
        );
        await tx.unsafe('release savepoint q');
        console.log('  ✓ genealogy_app 口令可改');
      } catch (e) {
        await tx.unsafe('rollback to savepoint q');
        console.log(
          `  ✗ genealogy_app 口令不可改 → ${e.code ?? '?'} ${e.message}`
        );
      }
      throw new Error('__rollback__');
    });
  } catch (e) {
    if (e.message !== '__rollback__') {
      console.log(`  实测阶段异常: ${e.code ?? '?'} ${e.message}`);
    }
  }
  console.log('  （以上改动已回滚）');
} catch (error) {
  console.error(`诊断失败: ${error.code ?? '?'} ${error.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
