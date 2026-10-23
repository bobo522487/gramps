import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/lib/db/schema';
import { resolveTestDatabaseUrl } from './db-url';

dotenv.config();

export function getTestDatabaseUrl(): string {
  return resolveTestDatabaseUrl(process.env);
}

// Point the application's lazy pool at the test database before any query.
const testDatabaseUrl = getTestDatabaseUrl();
process.env.POSTGRES_URL = testDatabaseUrl;

let testSql: ReturnType<typeof postgres> | null = null;

function createTestDb() {
  return drizzle(getTestSql(), { schema });
}

let testDb: ReturnType<typeof createTestDb> | null = null;

export function getTestSql() {
  if (!testSql) {
    testSql = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
  }
  return testSql;
}

export function getTestDb() {
  if (!testDb) {
    testDb = createTestDb();
  }
  return testDb;
}

export async function resetDatabase() {
  await getTestSql().unsafe(
    `TRUNCATE TABLE
       activity_logs,
       book_catalog,
       book,
       article,
       node,
       lineage,
       folder,
       project,
       invite,
       organization_member,
       organization,
       auth.users
     RESTART IDENTITY CASCADE`
  );
}

export async function closeTestDatabase() {
  if (!testSql) {
    return;
  }
  await testSql.end({ timeout: 5 });
  testSql = null;
  testDb = null;
}
