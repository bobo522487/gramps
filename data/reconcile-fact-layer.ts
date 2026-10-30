import type { Sql } from 'postgres';
import postgres from 'postgres';
import {
  RECONCILE_CHECKS,
  type ReconcileCheck,
  reconcileFactLayer,
} from '../lib/db/backfill/reconcile-fact-layer';
import { loadEnv } from '../scripts/load-env.mjs';

// Runs outside the Next.js runtime (tsx, not the app), so it loads .env itself
// and reads process.env directly; pnpm arch:check only guards app/components/
// lib/hooks for that. Output is JSON lines on stdout so it stays pipeable into
// jq; the one exception is the final `reconcile ok` line, which is the
// human-readable terminator the runbook asks for.
//
// This CLI is read-only: it only ever SELECTs (see reconcile-fact-layer.ts,
// which runs every statement inside `begin read only`).

const USAGE = `usage: pnpm data:reconcile:fact --org <organization-uuid>

Recomputes every fact-layer count from node with an independent SQL
implementation and compares it with what the backfill wrote: person,
person_name, family, family_partner, family_child and event. Read-only. Prints
one JSON line per difference, then a summary line; exits 1 when any check
differs and 0 when all ten agree.`;

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

/** Reads the same role the backfill wrote as, so both see the same rows. */
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
 * RLS enabled and forced. A role without rolsuper or rolbypassrls would not be
 * refused — it would count zero rows and report every check as a false diff.
 * Fail before printing anything instead.
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
      `refusing to run: role "${role.role_name}" has neither rolsuper nor rolbypassrls, so row-level security would hide the fact-layer rows and turn every check into a false diff; connect as the migration/CLI role`
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
    const report = await reconcileFactLayer(sql, organizationId);
    const byName = new Map<string, ReconcileCheck>(
      RECONCILE_CHECKS.map((check): [string, ReconcileCheck] => [
        check.name,
        check,
      ])
    );

    for (const diff of report.diffs) {
      const check = byName.get(diff.check);
      if (check === undefined) {
        throw new Error(
          `reconciliation reported an unknown check: ${diff.check}`
        );
      }
      // The SQL travels with the difference: "expected 1, actual 0" is not
      // actionable on its own, the operator has to see what was compared.
      console.log(
        JSON.stringify({
          organizationId,
          check: diff.check,
          expected: diff.expected,
          actual: diff.actual,
          expectedSql: check.expectedSql,
          actualSql: check.actualSql,
        })
      );
    }
    console.log(
      JSON.stringify({
        summary: {
          organizationId,
          checks: report.checked.length,
          diffs: report.diffs.length,
        },
      })
    );
    if (report.diffs.length === 0) {
      console.log('reconcile ok: 1 organization');
    }
    process.exitCode = report.diffs.length === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
