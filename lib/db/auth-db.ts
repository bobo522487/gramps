import 'server-only';

import { attachDatabasePool } from '@vercel/functions';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getServerConfig, isVercel } from '@/lib/config';
import * as schema from './schema';

// Better Auth must run as auth_service on every connection. The single target
// baseline deliberately keeps auth.* out of genealogy_app's reach: those four
// tables have no RLS (verified on PG18), so a shared business role would be
// able to read auth.account.password and auth.session tokens. auth_service is
// a separate NOLOGIN role provisioned out of band; this startup parameter
// pins it before any query runs.
function createAuthDb() {
  const config = getServerConfig();
  if (isVercel() && !config.AUTH_POSTGRES_URL) {
    throw new Error(
      'AUTH_POSTGRES_URL is required on Vercel: point it at the auth_runtime login role.'
    );
  }
  const connectionString = config.AUTH_POSTGRES_URL ?? config.POSTGRES_URL;
  const pool = new Pool({
    connectionString,
    max: 5,
    options: '-c role=auth_service',
  });

  if (isVercel()) {
    attachDatabasePool(pool);
  }

  return drizzle(pool, { schema });
}

type AuthDb = ReturnType<typeof createAuthDb>;

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
