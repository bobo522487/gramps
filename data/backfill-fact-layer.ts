import type { Sql } from 'postgres';
import postgres from 'postgres';
import {
  backfillFactLayer,
  FactLayerAlreadyBackfilledError,
} from '../lib/db/backfill/fact-layer';
import { loadEnv } from '../scripts/load-env.mjs';

// Runs outside the Next.js runtime (tsx, not the app), so it loads .env itself
// and reads process.env directly; pnpm arch:check only guards app/components/
// lib/hooks for that. Output is JSON lines on stdout: this is an operator CLI,
// not a request handler, and it must stay pipeable into jq.

const USAGE = `usage: pnpm data:backfill:fact --org <organization-uuid>

Moves one organization's node rows into the fact layer: person, person_name,
family, family_partner, family_child and event. It runs in a single
transaction, never writes back to node, and refuses to run when the
organization already has person rows (that pre-check is the only re-run
guard, because event has no idempotency key).`;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseOrganizationId(argv: string[]): string | null {
  const index = argv.indexOf('--org');
  if (index === -1) {
    return null;
  }
  const value = argv[index + 1];
  if (value === undefined || !UUID_PATTERN.test(value)) {
    return null;
  }
  return value;
}

/** The CLI writes as the migration role, so it must not go through a pooler. */
function resolveDatabaseUrl(): string {
  const url =
    process.env.POSTGRES_URL_DIRECT ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'POSTGRES_URL_DIRECT, POSTGRES_URL_NON_POOLING or POSTGRES_URL must be set'
    );
  }
  return url;
}

/**
 * person, person_name, family, family_partner, family_child and event all have
 * RLS enabled and forced; a role without rolsuper or rolbypassrls would be
 * rejected mid-backfill. Fail before writing anything instead.
 */
async function assertPrivilegedRole(sql: Sql): Promise<void> {
  const rows = await sql<
    { role_name: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT current_user AS role_name, rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (role === undefined) {
    throw new Error('could not read the connected role from pg_roles');
  }
  if (!role.rolsuper && !role.rolbypassrls) {
    console.error(
      `refusing to run: role "${role.role_name}" has neither rolsuper nor rolbypassrls, so row-level security would reject the fact-layer inserts; connect as the migration/CLI role`
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  loadEnv();
  const organizationId = parseOrganizationId(process.argv.slice(2));
  if (organizationId === null) {
    console.error(USAGE);
    process.exit(2);
  }

  const sql = postgres(resolveDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    await assertPrivilegedRole(sql);
    const result = await backfillFactLayer(sql, organizationId);
    console.log(
      JSON.stringify({
        organizationId: result.organizationId,
        persons: result.persons,
        families: result.families,
        lossReport: result.lossReport,
      })
    );
    console.log(
      JSON.stringify({
        summary: {
          organizationId: result.organizationId,
          persons: result.persons,
          personNames: result.personNames,
          families: result.families,
          familyPartners: result.familyPartners,
          familyChildren: result.familyChildren,
          events: result.events,
          lossReport: result.lossReport,
        },
      })
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  if (error instanceof FactLayerAlreadyBackfilledError) {
    console.error(
      `refusing to run: ${error.message}. A redo needs an out-of-band hard delete by the CLI superuser role, because event has no idempotency key.`
    );
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
