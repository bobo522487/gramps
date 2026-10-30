import { pathToFileURL } from 'node:url';
import type { Sql } from 'postgres';
import postgres from 'postgres';
import {
  RECONCILE_CHECKS,
  type ReconcileCheck,
  reconcileFactLayer,
} from '../lib/db/backfill/reconcile-fact-layer';
import { loadEnv } from '../scripts/load-env.mjs';
import {
  EXIT_FINDING,
  EXIT_INFRASTRUCTURE,
  EXIT_OK,
  EXIT_USAGE,
} from './exit-codes';

// Runs outside the Next.js runtime (tsx, not the app), so it loads .env itself
// and reads process.env directly; pnpm arch:check only guards app/components/
// lib/hooks for that. Output is JSON lines on stdout so it stays pipeable into
// jq; the one exception is the final `reconcile ok` line, which is the
// human-readable terminator the runbook asks for.
//
// This CLI is read-only: it only ever SELECTs (see reconcile-fact-layer.ts,
// which runs every statement inside a read-only repeatable-read transaction).

const USAGE = `usage: pnpm data:reconcile:fact --org <organization-uuid>

Recomputes every fact-layer count from node with an independent SQL
implementation and compares it with what the backfill wrote: person,
person_name, family, family_partner, family_child and event. Read-only. Prints
one JSON line per difference, then a summary line.

Exit codes: 0 when all fourteen checks agree, 1 when any differs, 2 for usage,
3 when the check could not run at all (credentials, missing tables, no
connection).`;

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
async function hasPrivilegedRole(sql: Sql): Promise<boolean> {
  const rows = await sql<
    { role_name: string; rolsuper: boolean; rolbypassrls: boolean }[]
  >`SELECT current_user AS role_name, rolsuper, rolbypassrls
    FROM pg_roles WHERE rolname = current_user`;
  const role = rows[0];
  if (role === undefined) {
    throw new Error('could not read the connected role from pg_roles');
  }
  if (role.rolsuper || role.rolbypassrls) {
    return true;
  }
  console.error(
    `refusing to run: role "${role.role_name}" has neither rolsuper nor rolbypassrls, so row-level security would hide the fact-layer rows and turn every check into a false diff; connect as the migration/CLI role`
  );
  return false;
}

/** Runs the CLI and returns its exit code; exported so tests can call it. */
export async function runCli(argv: string[]): Promise<number> {
  loadEnv();
  const organizationId = parseOrganizationId(argv);
  if (organizationId === null) {
    console.error(USAGE);
    return EXIT_USAGE;
  }

  const sql = postgres(resolveDatabaseUrl(), { max: 1, onnotice: () => {} });
  try {
    if (!(await hasPrivilegedRole(sql))) {
      return EXIT_INFRASTRUCTURE;
    }
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
      return EXIT_OK;
    }
    return EXIT_FINDING;
  } catch (error) {
    console.error(error);
    return EXIT_INFRASTRUCTURE;
  } finally {
    await sql.end();
  }
}

// Only run when executed directly (`tsx data/reconcile-fact-layer.ts`);
// importing the module — the CLI test does — must not connect or exit.
// `tsx` compiles this file as CommonJS (package.json has no "type": "module"),
// where a top-level `await` is a transform error — hence `.then()`, not `await`.
if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = EXIT_INFRASTRUCTURE;
    }
  );
}
