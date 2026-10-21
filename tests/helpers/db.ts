import dotenv from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/lib/db/schema';

dotenv.config();

export function getTestDatabaseUrl(): string {
  const url = process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'Integration tests need TEST_POSTGRES_URL (or POSTGRES_URL) pointing to a dedicated test database.'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('TEST_POSTGRES_URL is not a valid PostgreSQL URL.');
  }

  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run integration tests against "${database}": database name must end with "_test". Set TEST_POSTGRES_URL to a dedicated test database.`
    );
  }

  return url;
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
    'TRUNCATE TABLE activity_logs, invitations, org_members, projects, organizations, users RESTART IDENTITY CASCADE'
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
