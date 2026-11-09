#!/usr/bin/env node
/**
 * 生产库迁移失败时的只读诊断。
 *
 * 2026-11-09 重建演练踩到：`drizzle-kit migrate` 失败时只打印进度条，把
 * 真实 SQLSTATE 吞了，害得排查只能靠猜。这个脚本把基线逐语句在**一个会
 * 回滚的事务**里跑一遍，报出第一条失败语句与它的 SQLSTATE。
 *
 * 只读：全程 `BEGIN ... ROLLBACK`，不改任何数据。
 */

import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const databaseUrl =
  process.env.POSTGRES_URL_DIRECT ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  '';

if (!databaseUrl) {
  console.error('缺少数据库连接串。');
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

function splitStatements(source) {
  // 基线里没有函数体外的美元引号冲突：DO $$ 与 CREATE FUNCTION $$ 都以
  // `$$;` 收尾，按行首 `$$;` 切分会误伤。这里按 `;` + 行尾切分，跳过注释行。
  const lines = source.split('\n');
  const statements = [];
  let buffer = [];
  let inDollar = false;
  let tag = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inDollar && (trimmed === '' || trimmed.startsWith('--'))) {
      continue;
    }
    buffer.push(line);
    // 检测美元引号开关（$$ 或 $tag$）。
    const matches = line.match(/\$([A-Za-z_]*)\$/g);
    if (matches) {
      for (const match of matches) {
        if (!inDollar) {
          inDollar = true;
          tag = match;
        } else if (match === tag) {
          inDollar = false;
          tag = '';
        }
      }
    }
    if (!inDollar && trimmed.endsWith(';')) {
      statements.push(buffer.join('\n'));
      buffer = [];
    }
  }
  if (buffer.length > 0) statements.push(buffer.join('\n'));
  return statements;
}

const source = readFileSync(
  new URL('../lib/db/migrations/0000_target_schema.sql', import.meta.url),
  'utf8'
);
const statements = splitStatements(source);
console.log(`# 基线共 ${statements.length} 条语句，逐条试跑（事务内回滚）`);

let failed = 0;
await sql
  .begin(async (tx) => {
    for (const [index, statement] of statements.entries()) {
      const head = statement.trim().split('\n')[0].slice(0, 90);
      // 每条语句一个 SAVEPOINT：失败只回滚到该点，继续试下一条，
      // 一次列出所有卡点，而不是撞到第一条就停。
      await tx.unsafe('savepoint probe');
      try {
        await tx.unsafe(statement);
        await tx.unsafe('release savepoint probe');
      } catch (error) {
        await tx.unsafe('rollback to savepoint probe');
        failed += 1;
        console.log(`FAIL #${index + 1} ${head}`);
        console.log(`   SQLSTATE=${error.code ?? '?'}  ${error.message}`);
        if (error.detail) console.log(`   detail: ${error.detail}`);
        if (error.hint) console.log(`   hint: ${error.hint}`);
      }
    }
    // 整体回滚，库不被修改。
    throw new Error('__rollback__');
  })
  .catch((error) => {
    if (error?.message !== '__rollback__') {
      console.log(`试跑异常：${error?.message}`);
    }
  });

console.log(
  failed === 0
    ? `全部 ${statements.length} 条语句可执行（已回滚，未改库）。`
    : `${failed} 条失败（已回滚，未改库）。`
);

// search_path 是「裸名建对象落在哪个 schema」的唯一依据，Neon 与本地不同。
const [env] = await sql`
  select current_setting('search_path') as sp, current_user as usr,
         current_database() as db
`;
console.log(`\n# search_path=${env.sp} · 角色=${env.usr} · 库=${env.db}`);

await sql.end({ timeout: 5 });
