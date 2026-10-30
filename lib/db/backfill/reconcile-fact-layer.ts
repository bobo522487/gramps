import type { Sql, TransactionSql } from 'postgres';

// The independent half of the fact-layer gate: every expectation below is
// recomputed from `node` with its own SQL, and compared with the count the
// backfill actually wrote. This module imports *nothing* from
// lib/db/backfill/fact-layer.ts or fact-layer-rules.ts — no helper, no
// constant, no tiering function. Two implementations that shared code could
// only ever agree with themselves; the whole value of this file is that it can
// disagree with the backfill.
//
// Read-only by construction: every statement is a SELECT, and they all run
// inside `begin read only`, so an accidental write would fail with 25006
// instead of mutating the data it is measuring.

export type ReconcileDiff = { check: string; expected: number; actual: number };

export type ReconcileReport = {
  organizationId: string;
  diffs: ReconcileDiff[];
  checked: string[];
};

/** One check: the same `count(*)` computed from `node` and from the fact layer. */
export type ReconcileCheck = {
  name: string;
  expectedSql: string;
  actualSql: string;
};

/**
 * S(P) and C(P) for every live blood node P of the organization: the live
 * spouse nodes pointing at it and the live nodes hanging below it.
 *
 * `families` and `partners` share this fragment because they tier the same
 * census differently; they are still one implementation, and the numbers they
 * produce are compared with a backfill that computes the tiers in TypeScript.
 */
const BLOOD_CENSUS = `
    SELECT
      (SELECT count(*)
         FROM node s
        WHERE s.organization_id = p.organization_id
          AND s.role = 'spouse'
          AND s.spouse_of_id = p.id
          AND s.deleted_at IS NULL) AS spouses,
      (SELECT count(*)
         FROM node c
        WHERE c.organization_id = p.organization_id
          AND c.parent_id = p.id
          AND c.deleted_at IS NULL) AS children
      FROM node p
     WHERE p.organization_id = $1
       AND p.role = 'blood'
       AND p.deleted_at IS NULL`;

/**
 * The ten checks, each as a pair of `count(*)` statements over the same
 * organization id (`$1`).
 *
 * ## Two scopes, deliberately
 *
 * `persons`, `primary_names` and `courtesy_names` count **every** node of the
 * organization, soft-deleted ones included: the backfill copies `deleted_at`
 * onto the person and the name row instead of skipping the node, so a deleted
 * node is expected to have a (deleted) person and birth name.
 *
 * `families`, `partners`, `child_edges`, the three event checks and
 * `contentless_events` are **live-node only** (`deleted_at IS NULL`): the
 * backfill gives a soft-deleted node no family, no child edge and no event.
 * This asymmetry is part of the backfill's contract, not a convenience here —
 * a reader who assumes one scope for everything will "fix" the wrong half.
 *
 * The fact-layer side of the all-node checks also drops the `deleted_at`
 * filter, for the same reason; the live-node checks filter it on both sides,
 * so soft-deleting a fact-layer row shows up as a diff.
 */
export const RECONCILE_CHECKS: readonly ReconcileCheck[] = [
  {
    name: 'persons',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1`,
    actualSql: `SELECT count(*)::int AS count
      FROM person
     WHERE organization_id = $1`,
  },
  {
    name: 'primary_names',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1`,
    actualSql: `SELECT count(*)::int AS count
      FROM person_name
     WHERE organization_id = $1
       AND name_type = 'birth'`,
  },
  {
    name: 'courtesy_names',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND btrim(coalesce(courtesy, '')) <> ''`,
    actualSql: `SELECT count(*)::int AS count
      FROM person_name
     WHERE organization_id = $1
       AND name_type = 'courtesy'`,
  },
  {
    // |S|=1 → the one spouse family. |S|>1 → one family per spouse plus the
    // children-only family, which is created unconditionally: the middle term
    // is NOT conditioned on |C|>0. |S|=0 with children → one children-only
    // family. Everything else contributes nothing.
    name: 'families',
    expectedSql: `SELECT coalesce(sum(
        CASE
          WHEN census.spouses = 1 THEN 1
          WHEN census.spouses > 1 THEN census.spouses + 1
          WHEN census.children > 0 THEN 1
          ELSE 0
        END
      ), 0)::int AS count
      FROM (${BLOOD_CENSUS}) AS census`,
    actualSql: `SELECT count(*)::int AS count
      FROM family
     WHERE organization_id = $1
       AND deleted_at IS NULL`,
  },
  {
    // A spouse family has two partner rows (one blood, one spouse), so
    // 2·|S|, plus the blood row of the children-only family. Spouse nodes are
    // never tiered themselves and contribute no rows of their own.
    name: 'partners',
    expectedSql: `SELECT coalesce(sum(
        CASE
          WHEN census.spouses = 1 THEN 2
          WHEN census.spouses > 1 THEN 2 * census.spouses + 1
          WHEN census.children > 0 THEN 1
          ELSE 0
        END
      ), 0)::int AS count
      FROM (${BLOOD_CENSUS}) AS census`,
    actualSql: `SELECT count(*)::int AS count
      FROM family_partner
     WHERE organization_id = $1
       AND deleted_at IS NULL`,
  },
  {
    // Only live blood parents are tiered, so a child of a spouse node and a
    // child of a soft-deleted parent get no family_child row at all.
    name: 'child_edges',
    expectedSql: `SELECT count(*)::int AS count
      FROM node c
      JOIN node p
        ON p.id = c.parent_id
       AND p.organization_id = c.organization_id
       AND p.role = 'blood'
       AND p.deleted_at IS NULL
     WHERE c.organization_id = $1
       AND c.deleted_at IS NULL`,
    actualSql: `SELECT count(*)::int AS count
      FROM family_child
     WHERE organization_id = $1
       AND deleted_at IS NULL`,
  },
  {
    name: 'birth_events',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND (btrim(coalesce(birth_text, '')) <> '' OR birth_year IS NOT NULL)`,
    actualSql: `SELECT count(*)::int AS count
      FROM event
     WHERE organization_id = $1
       AND event_type = 'birth'
       AND deleted_at IS NULL`,
  },
  {
    name: 'death_events',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND (btrim(coalesce(death_text, '')) <> '' OR death_year IS NOT NULL)`,
    actualSql: `SELECT count(*)::int AS count
      FROM event
     WHERE organization_id = $1
       AND event_type = 'death'
       AND deleted_at IS NULL`,
  },
  {
    name: 'burial_events',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND btrim(coalesce(burial_place, '')) <> ''`,
    actualSql: `SELECT count(*)::int AS count
      FROM event
     WHERE organization_id = $1
       AND event_type = 'burial'
       AND deleted_at IS NULL`,
  },
  {
    // The Task 6 review's failure mode: a subject-only event is legal in the
    // schema (the subject XOR and the date matrix all pass) but says nothing,
    // so it can never be shown, exported or merged. Zero is the only honest
    // expectation; this check is what turns that invariant into a gate.
    name: 'contentless_events',
    expectedSql: `SELECT 0::int AS count`,
    actualSql: `SELECT count(*)::int AS count
      FROM event
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND date_original IS NULL
       AND date_start IS NULL
       AND date_end IS NULL
       AND place_original IS NULL
       AND value IS NULL
       AND description IS NULL`,
  },
];

async function countOf(
  tx: TransactionSql,
  statement: string,
  organizationId: string
): Promise<number> {
  // `contentless_events` expects a literal 0 and takes no parameter, and
  // PostgreSQL refuses a bind parameter the statement never uses ("could not
  // determine data type of parameter $1"), so the argument is conditional.
  const rows = statement.includes('$1')
    ? await tx.unsafe<{ count: number }[]>(statement, [organizationId])
    : await tx.unsafe<{ count: number }[]>(statement);
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`reconciliation query returned no row: ${statement}`);
  }
  return row.count;
}

/**
 * Compare every fact-layer count with the count `node` says it should have.
 *
 * A check whose two numbers differ is reported with both, so the operator sees
 * which side is wrong, not just that something is. The report is a snapshot:
 * all checks run in one read-only transaction.
 */
export async function reconcileFactLayer(
  sql: Sql,
  organizationId: string
): Promise<ReconcileReport> {
  return sql.begin('read only', async (tx) => {
    const diffs: ReconcileDiff[] = [];
    const checked: string[] = [];
    for (const check of RECONCILE_CHECKS) {
      const expected = await countOf(tx, check.expectedSql, organizationId);
      const actual = await countOf(tx, check.actualSql, organizationId);
      checked.push(check.name);
      if (expected !== actual) {
        diffs.push({ check: check.name, expected, actual });
      }
    }
    return { organizationId, diffs, checked };
  });
}
