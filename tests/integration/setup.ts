import { afterAll, beforeEach } from 'vitest';
import { closeAuthDb } from '@/lib/db/auth-db';
import { closeDb } from '@/lib/db/drizzle';
import { TEST_BETTER_AUTH_SECRET } from '../helpers/auth';
import {
  closeTestDatabase,
  getTestDatabaseUrl,
  resetDatabase,
} from '../helpers/db';
import {
  resolveAppTestDatabaseUrl,
  resolveAuthTestDatabaseUrl,
} from '../helpers/db-url';

process.env.BETTER_AUTH_SECRET = TEST_BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.POSTGRES_URL = getTestDatabaseUrl();
process.env.APP_POSTGRES_URL = resolveAppTestDatabaseUrl(process.env);
process.env.AUTH_POSTGRES_URL = resolveAuthTestDatabaseUrl(process.env);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
  await closeAuthDb();
  await closeDb();
});
