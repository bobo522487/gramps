import 'server-only';

import { attachDatabasePool } from '@vercel/functions';
import { config } from 'dotenv';
import { type SQL, sql } from 'drizzle-orm';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js';
import { Pool } from 'pg';
import postgres from 'postgres';
import { getServerConfig } from '@/lib/config';
import * as schema from './schema';

// Keep startup output quiet; dotenv >= 17 logs an injection summary by default.
config({ quiet: true });

type Db = PostgresJsDatabase<typeof schema> & {
  $client: ReturnType<typeof postgres>;
};

function createDb(): Db {
  const { POSTGRES_URL, APP_POSTGRES_URL } = getServerConfig();
  // APP_POSTGRES_URL points at the dedicated non-owner login role (`app`)
  // when the platform-managed URL uses the database owner.
  const connectionString = APP_POSTGRES_URL ?? POSTGRES_URL;

  if (process.env.VERCEL) {
    // Vercel Fluid compute: let the platform freeze/resume the pg pool
    // instead of leaking connections between invocations.
    const pool = new Pool({ connectionString, max: 5 });
    attachDatabasePool(pool);
    // The SQL surface used by the app is driver-agnostic.
    return drizzleNodePg(pool, { schema }) as unknown as Db;
  }

  return drizzlePostgres(postgres(connectionString), { schema });
}

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
 * Runs business queries as app_rw with the current user's claims so RLS is
 * enforced. SET LOCAL is required: a session-level SET would leak the role
 * and claims into the next request that borrows the pooled connection.
 */
export async function withOrg<T>(
  userId: string,
  fn: (tx: DbTransaction) => Promise<T>
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`set local role app_rw`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify({
        sub: userId,
        role: 'authenticated',
      })}, true)`
    );
    return fn(tx);
  });
}

type Executor = { execute: (query: SQL) => Promise<unknown> };

/**
 * Normalizes raw SQL results across postgres.js (array) and node-postgres
 * ({ rows }) so auth functions work in both local/CI and Vercel.
 */
export async function queryRows<T>(
  executor: Executor,
  query: SQL
): Promise<T[]> {
  const result = await executor.execute(query);
  if (Array.isArray(result)) {
    return result as T[];
  }
  return (result as { rows: T[] }).rows;
}
