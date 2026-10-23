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

type AuthDb = PostgresJsDatabase<typeof schema> & {
  $client: ReturnType<typeof postgres>;
};

// Better Auth must run as auth_service on every connection: RLS policies for
// identity/tenant writes are granted to that role only.
function createAuthDb(): AuthDb {
  const config = getServerConfig();
  if (process.env.VERCEL && !config.AUTH_POSTGRES_URL) {
    throw new Error(
      'AUTH_POSTGRES_URL is required on Vercel: point it at the auth_runtime login role.'
    );
  }
  const connectionString = config.AUTH_POSTGRES_URL ?? config.POSTGRES_URL;

  if (process.env.VERCEL) {
    const pool = new Pool({
      connectionString,
      max: 5,
      options: '-c role=auth_service',
    });
    attachDatabasePool(pool);
    return drizzleNodePg(pool, { schema }) as unknown as AuthDb;
  }

  // postgres.js 3.4 has no `onconnect`; the startup `options` parameter is
  // sent by both drivers and pins the role before any query runs.
  return drizzlePostgres(
    postgres(connectionString, {
      connection: { options: '-c role=auth_service' },
    }),
    { schema }
  );
}

let instance: AuthDb | null = null;

export function getAuthDb(): AuthDb {
  if (!instance) {
    instance = createAuthDb();
  }
  return instance;
}

export async function closeAuthDb(): Promise<void> {
  if (!instance) {
    return;
  }
  await instance.$client.end();
  instance = null;
}

export async function resetAuthDb(): Promise<void> {
  await closeAuthDb();
}
