import { afterAll, beforeEach } from 'vitest';
import { closeDb } from '@/lib/db/drizzle';
import { TEST_AUTH_SECRET } from '../helpers/auth';
import {
  closeTestDatabase,
  getTestDatabaseUrl,
  resetDatabase,
} from '../helpers/db';

process.env.AUTH_SECRET = TEST_AUTH_SECRET;
process.env.POSTGRES_URL = getTestDatabaseUrl();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closeTestDatabase();
  await closeDb();
});
