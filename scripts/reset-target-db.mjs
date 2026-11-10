#!/usr/bin/env node
/**
 * 生产库重建前置：把目标库清成「空库」，让唯一基线 `0000_target_schema` 能整段落库。
 *
 * 为什么需要它：G0① 决议是「整体重建基线、`0000_target_schema.sql` 是唯一 DDL 真相源」。
 * 但该基线对 `auth.*` 表用了 `CREATE TABLE IF NOT EXISTS`（为了在本仓库的
 * 测试库上可重复执行）。一旦库里已经有同名旧表，那些表会被**整表跳过**，
 * 结构原样留旧、后续索引与策略语句对着旧表建，而 drizzle-kit 看到迁移记录里
 * 没有 0000，插一条记录就报 `migrations applied successfully`——假绿。
 * 2026-11-09 的生产迁移 job 就是这么红起来的。
 *
 * 所以「重建」必须显式清空，不能指望基线自己擦屁股。本脚本只做清空，
 * 不做建表：建表仍只由 `pnpm db:migrate` 执行那一份基线。
 *
 * 幂等与安全：
 * - 默认 dry-run，只打印将要删除什么；必须显式 `--apply` 才动库。
 * - 必须同时给 `--confirm=<库名>`，且与连接串里的库名逐字相等。
 * - 拒绝在 `postgres` / `template0` / `template1` 上执行。
 * - 清空范围写死为 `public` / `auth` / `app` / `drizzle` 四个 schema，
 *   不碰其它 schema，也不 drop 数据库本身。
 * - 角色（`genealogy_app` / `auth_service`）**不删**：角色是集群级对象，
 *   删了会连带 existing 会话与其它库的授权；基线里对它们的创建本来就是
 *   `IF NOT EXISTS`，且属性由 `verify:deploy` 单独断言。
 */

import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const MANAGED_SCHEMAS = ['public', 'auth', 'app', 'drizzle'];
const FORBIDDEN_DATABASES = new Set(['postgres', 'template0', 'template1']);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmArg = args.find((arg) => arg.startsWith('--confirm='));
const confirm = confirmArg ? confirmArg.slice('--confirm='.length) : '';

const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';

function die(message) {
  console.error(`拒绝执行：${message}`);
  process.exit(1);
}

if (!databaseUrl) {
  die('未设置 POSTGRES_URL_DIRECT / POSTGRES_URL_NON_POOLING / POSTGRES_URL。');
}

let databaseName;
try {
  // 连接串可能带 query（sslmode 等），只取 pathname。
  databaseName = decodeURIComponent(
    new URL(databaseUrl).pathname.replace(/^\//, '')
  );
} catch {
  die('数据库连接串无法解析。');
}

if (!databaseName) {
  die('连接串里没有库名。');
}
if (FORBIDDEN_DATABASES.has(databaseName)) {
  die(`目标库是 ${databaseName}，系统库不允许清空。`);
}
if (!apply) {
  console.log(`# dry-run（加 --apply 才会真的清空）`);
} else if (confirm !== databaseName) {
  die(
    `--confirm 与目标库名不一致（期望 --confirm=${databaseName}，实际 ${confirm || '未提供'}）。`
  );
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

/** 清空时要删的东西，按依赖倒序处理。全部在同一个事务里。 */
async function inspect() {
  const schemas = await sql`
    select nspname from pg_namespace where nspname in ${sql(MANAGED_SCHEMAS)}
  `;
  const present = schemas.map((row) => row.nspname);

  const tables = await sql`
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ${sql(present)}
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
    order by 1, 2
  `;
  const functions = await sql`
    select n.nspname, count(*)::int as count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ${sql(present)}
    group by 1 order by 1
  `;
  const sequences = await sql`
    select n.nspname, count(*)::int as count
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ${sql(present)} and c.relkind = 'S'
    group by 1 order by 1
  `;
  return { present, tables, functions, sequences };
}

function summarize(label, rows, render) {
  if (rows.length === 0) {
    console.log(`${label}: 0`);
    return;
  }
  console.log(`${label}: ${rows.length}`);
  for (const row of rows) console.log(`  - ${render(row)}`);
}

try {
  const before = await inspect();
  console.log(`# 目标库 ${databaseName}`);
  console.log(`# 存在的受管 schema：${before.present.join(', ') || '（无）'}`);
  summarize(
    '表 / 视图 / 实体化视图',
    before.tables,
    (r) => `${r.nspname}.${r.relname}`
  );
  summarize('序列', before.sequences, (r) => `${r.nspname}: ${r.count}`);
  summarize('函数', before.functions, (r) => `${r.nspname}: ${r.count}`);

  if (!apply) {
    console.log(
      `\n# 未做任何修改。确认无误后追加 --apply --confirm=${databaseName}`
    );
    await sql.end({ timeout: 5 });
    process.exit(0);
  }

  // `public` 不动 schema 本身，只清里面的对象：PostgreSQL 默认就带 `public`，
  // 而且 `CREATE EXTENSION` 在没有 search_path 目标时会报
  // 「no schema has been selected to create in」。2026-11-09 演练踩过这个坑。
  //
  // 其余三个 schema 是目标态自己的产物，整个删掉更干净（`auth` / `app` 里
  // 的旧函数、旧策略、旧触发器一并清掉，不留残骸）。
  await sql.begin(async (tx) => {
    const dropSchema = before.present.filter((schema) => schema !== 'public');
    for (const schema of dropSchema) {
      await tx.unsafe(`drop schema if exists "${schema}" cascade`);
    }
    if (before.present.includes('public')) {
      await tx.unsafe('drop schema if exists public cascade');
      await tx.unsafe('create schema public');
    }
  });

  const after = await inspect();
  console.log(
    `\n清空完成：受管 schema 剩余 ${after.present.length} 个（public 重建为空），表 ${after.tables.length} 张，序列 ${after.sequences.length} 组。`
  );
  // public 必须还在：基线里的 CREATE EXTENSION 需要它作为落点。
  if (!after.present.includes('public')) {
    console.error('清空后 public schema 丢失，基线将无法执行。');
    await sql.end({ timeout: 5 });
    process.exit(1);
  }
  console.log('接下来由 `pnpm db:migrate` 执行唯一基线 0000_target_schema。');
  await sql.end({ timeout: 5 });
} catch (error) {
  const code =
    error && typeof error === 'object' && 'code' in error ? error.code : '';
  console.error(
    `清空失败${code ? `（SQLSTATE ${code}）` : ''}：${error.message}`
  );
  await sql.end({ timeout: 5 });
  process.exit(1);
}
