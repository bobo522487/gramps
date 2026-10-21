import 'server-only';

import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

dotenv.config();

function createDb() {
  if (!process.env.POSTGRES_URL) {
    throw new Error(
      'POSTGRES_URL environment variable is not set. Copy .env.example, run `pnpm db:setup`, then retry.'
    );
  }
  return drizzle(postgres(process.env.POSTGRES_URL), { schema });
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
