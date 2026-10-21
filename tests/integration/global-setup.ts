import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { getTestDatabaseUrl } from '../helpers/db';

export default async function setup() {
  const sql = postgres(getTestDatabaseUrl(), {
    max: 1,
    onnotice: () => {},
  });

  try {
    await migrate(drizzle(sql), {
      migrationsFolder: 'lib/db/migrations',
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
