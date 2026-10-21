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
    // The foundation-reset ADR squashes history; wipe any previous test
    // schema so migrations always run from scratch.
    await sql.unsafe('drop extension if exists ltree cascade');
    await sql.unsafe('drop extension if exists pg_trgm cascade');
    await sql.unsafe('drop extension if exists btree_gist cascade');
    await sql.unsafe('drop schema if exists public cascade');
    await sql.unsafe('drop schema if exists auth cascade');
    await sql.unsafe('drop schema if exists drizzle cascade');
    await sql.unsafe('create schema public');

    await migrate(drizzle(sql), {
      migrationsFolder: 'lib/db/migrations',
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
