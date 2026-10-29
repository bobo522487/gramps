import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@/lib/db/schema';
import { loadEnv } from '@/scripts/load-env.mjs';
import { resolveTestDatabaseUrl } from './db-url';

// Before any read of process.env below: `testDatabaseUrl` is resolved at module
// load, so a late load would leave POSTGRES_URL undefined for every test.
loadEnv();

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
       auth.session,
       auth.account,
       auth.verification,
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

/** Objects along a driver, Drizzle or Better Auth error chain, outermost first. */
function errorChain(error: unknown): object[] {
  const chain: object[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    chain.push(current);
    current = (current as { cause?: unknown }).cause;
  }
  return chain;
}

/** SQLSTATE from a driver, Drizzle or Better Auth error chain. */
export function pgErrorCode(error: unknown): string | undefined {
  for (const link of errorChain(error)) {
    const code = (link as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

/**
 * Every message in the chain, outermost first. The SQLSTATE alone cannot tell
 * two controls apart when both raise 42501 (RLS WITH CHECK does), so callers
 * assert on the server text as well; the wrapper's own message ("Failed
 * query: …") is included, hence "every" rather than "the".
 */
export function pgErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  for (const link of errorChain(error)) {
    const message = (link as { message?: unknown }).message;
    if (typeof message === 'string') {
      messages.push(message);
    }
  }
  return messages;
}
