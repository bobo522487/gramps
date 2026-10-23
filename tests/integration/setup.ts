import { afterAll, beforeEach } from 'vitest';
import { closeDb } from '@/lib/db/drizzle';
import { TEST_BETTER_AUTH_SECRET } from '../helpers/auth';
import {
  closeTestDatabase,
  getTestDatabaseUrl,
  resetDatabase,
} from '../helpers/db';

process.env.BETTER_AUTH_SECRET = TEST_BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_URL = 'http://localhost:3000';
process.env.POSTGRES_URL = getTestDatabaseUrl();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
  await closeDb();
});
