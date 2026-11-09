// 临时：在真实目标库上跑 drizzle 的迁移路径，但把错误完整打出来。
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const url = process.env.POSTGRES_URL_DIRECT;
const sql = postgres(url, { max: 1, onnotice: () => {} });
const file = readFileSync('lib/db/migrations/0000_target_schema.sql', 'utf8');

try {
  // 1) 整份一次发送（drizzle 的 pg 驱动分支就是这么发的）
  try {
    await sql.unsafe(file);
    console.log('A) 整份一次发送：成功');
  } catch (e) {
    console.log('A) 整份一次发送：失败 ->', e.code, e.message);
    if (e.position) console.log('   position:', e.position);
  }

  // 2) 事务内整份发送
  try {
    await sql.begin(async (tx) => { await tx.unsafe(file); });
    console.log('B) 事务内整份：成功');
  } catch (e) {
    console.log('B) 事务内整份：失败 ->', e.code, e.message);
  }

  const [n] = await sql`select count(*)::int c from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth') and c.relkind='r'`;
  console.log('   当前表数:', n.c);
} finally {
  await sql.end({ timeout: 5 });
}
