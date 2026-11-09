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
    select rolname, rolcanlogin from pg_roles
    where rolname in ('genealogy_app', 'auth_service', 'auth_runtime')
  `;
  console.log(
    `角色: ${roles.map((r) => `${r.rolname}(login=${r.rolcanlogin})`).join(', ') || '（无）'}`
  );
} catch (error) {
  console.error(`诊断失败: ${error.code ?? '?'} ${error.message}`);
} finally {
  await sql.end({ timeout: 5 });
}
