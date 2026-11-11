import 'server-only';

import { attachDatabasePool } from '@vercel/functions';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getServerConfig, isVercel } from '@/lib/config';
import * as schema from './schema';

function createDb() {
  const { POSTGRES_URL, APP_POSTGRES_URL } = getServerConfig();
  // APP_POSTGRES_URL points at the dedicated non-owner login role (`app`)
  // when the platform-managed URL uses the database owner.
  const connectionString = APP_POSTGRES_URL ?? POSTGRES_URL;
  const pool = new Pool({ connectionString, max: 5 });

  if (isVercel()) {
    // Vercel Fluid compute: let the platform freeze/resume the pg pool
    // instead of leaking connections between invocations. This is the only
    // environment branch: the driver itself is identical everywhere.
    attachDatabasePool(pool);
  }

  return drizzle(pool, { schema });
}

type Db = ReturnType<typeof createDb>;

let instance: Db | null = null;

function getDb(): Db {
  if (!instance) {
    instance = createDb();
  }
  return instance;
}

// Deferred so typecheck/tests/build work without POSTGRES_URL; first query
// connects (and fails with a clear message) instead of module import.
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const value = Reflect.get(getDb(), prop, getDb());
    return typeof value === 'function' ? value.bind(getDb()) : value;
  },
});

/** Closes the shared pool; integration tests call this between files. */
export async function closeDb() {
  if (!instance) {
    return;
  }
  await instance.$client.end();
  instance = null;
}

export type DbTransaction = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * Runs business queries as genealogy_app with the current user's claims so
 * RLS is enforced. genealogy_app is the LOGIN role created by the single
 * target baseline (A.0); it has public-schema DML and app-schema EXECUTE but
 * no auth-schema access — the auth connection stays on its own role so the
 * credential tables (which have no RLS) are never readable from here.
 * SET LOCAL is required: a session-level SET would leak the role and claims
 * into the next request that borrows the pooled connection.
 *
 * GUC 名必须是 `app.user_id`：`app.current_user_id()` 读的就是它
 * （`nullif(current_setting('app.user_id', true), '')`），规格见
 * docs/data-model.md §3「会话上下文由应用服务在同一事务内用 SET LOCAL
 * app.user_id 注入」。原来这里写的是 `request.jwt.claims`——那是旧实现的
 * 命名，A.6 的函数根本不看它，结果是每个 withOrg 事务里
 * `visible_org_array()` 恒返回空数组，所有组织查询静默返回 0 行
 * （不是报错，所以很难发现）。
 */
export async function withOrg<T>(
  userId: string,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role genealogy_app`);
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Normalizes raw SQL results for callers that execute hand-written SQL.
 * node-postgres returns `{ rows }`; Drizzle types the result as `unknown`.
 */
export async function queryRows<T>(
  executor: Executor,
  query: SQL
): Promise<T[]> {
  const result = await executor.execute(query);
  return (result as { rows: T[] }).rows;
}
