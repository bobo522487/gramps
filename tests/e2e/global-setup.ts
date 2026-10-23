import { resetAndMigrate } from '../helpers/db-setup';
import {
  assertExternalModeAllowed,
  isExternalMode,
  resolveE2EBaseUrl,
  resolveE2ETestDatabaseUrl,
} from './env';

export default async function globalSetup() {
  assertExternalModeAllowed();

  if (isExternalMode()) {
    console.log(
      `[e2e] external server mode: skipping database reset (${resolveE2EBaseUrl()})`
    );
    return;
  }

  await resetAndMigrate(resolveE2ETestDatabaseUrl());
  console.log('[e2e] test database reset and migrated');
}
