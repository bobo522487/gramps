import { resetAndMigrate } from '../helpers/db-setup';
import { resolveTestDatabaseUrl } from '../helpers/db-url';

export default async function setup() {
  await resetAndMigrate(resolveTestDatabaseUrl(process.env));
}
