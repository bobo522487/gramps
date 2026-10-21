import 'server-only';

import { attachDatabasePool } from '@vercel/functions';
import dotenv from 'dotenv';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import {
  drizzle as drizzlePostgres,
  type PostgresJsDatabase,
} from 'drizzle-orm/postgres-js';
import { Pool } from 'pg';
import postgres from 'postgres';
import { getServerConfig } from '@/lib/config';
import * as schema from './schema';

dotenv.config();

type Db = PostgresJsDatabase<typeof schema> & {
  $client: ReturnType<typeof postgres>;
};

function createDb(): Db {
  const { POSTGRES_URL } = getServerConfig();

  if (process.env.VERCEL) {
    // Vercel Fluid compute: let the platform freeze/resume the pg pool
    // instead of leaking connections between invocations.
    const pool = new Pool({ connectionString: POSTGRES_URL, max: 5 });
    attachDatabasePool(pool);
    // The SQL surface used by the app is driver-agnostic.
    return drizzleNodePg(pool, { schema }) as unknown as Db;
  }

  return drizzlePostgres(postgres(POSTGRES_URL), { schema });
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
