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
 * The checks, each as a pair of `count(*)` statements over the same
 * organization id (`$1`).
 *
 * ## What this is, and is not
 *
 * `node` is the only source of truth in P1; the fact layer is a projection of
 * it. So every check here is either a **property invariant** of the fact layer
 * (a count that must be 0, or a count that must equal a count of `node` rows)
 * or a **re-derivation** of the backfill's own convention. The three family
 * checks (`families`, `partners`, `child_edges`) are re-derivations: `node` has
 * no mother link, so the tiering (`|S|=0/1/>1`, the children-only family) is a
 * convention the backfill invented and this file re-implements in SQL. They
 * catch implementation drift between the two files; they are not a second
 * source of truth, and a bug in the convention itself is invisible to them —
 * `node` and the fact layer would agree on the wrong answer. That is why the
 * property checks exist, and why `tests/integration/fact-reconcile.test.ts`
 * carries one deliberate divergence per check.
 *
 * ## Two scopes, deliberately
 *
 * `persons`, `primary_names`, `courtesy_names` and `person_deleted_state` count
 * **every** node of the organization, soft-deleted ones included: the backfill
 * copies `deleted_at` onto the person and the name row instead of skipping the
 * node, so a deleted node is expected to have a (deleted) person and birth name.
 *
 * `families`, `partners`, `child_edges`, `orphan_children`, the three event
 * checks and `contentless_events` are **live-node only** (`deleted_at IS NULL`):
 * the backfill gives a soft-deleted node no family, no child edge and no event.
 * This asymmetry is part of the backfill's contract, not a convenience here —
 * a reader who assumes one scope for everything will "fix" the wrong half.
 *
 * The fact-layer side of the all-node checks also drops the `deleted_at`
 * filter, for the same reason. `person_deleted_state` is the one place where a
 * soft-deleted fact-layer row is itself the subject: it compares the number of
 * deleted persons with the number of deleted nodes, so a person deleted behind
 * the backfill's back is a diff. Nothing checks the soft-delete state of
 * families or events; those are only counted while live.
 *
 * ## Property checks with a literal expectation
 *
 * `primary_name_links`, `orphan_children`, `contentless_events` and
 * `event_subjects` expect 0 and take no parameter in the expected statement.
 * `contentless_events` and `event_subjects` count the fact layer;
 * `primary_name_links` counts live persons; `orphan_children` counts `node`
 * itself — a child whose `parent_id` is not a live blood node cannot get a
 * `family_child` row, so the loss report counts it and this check fails the
 * organization instead of letting the edge disappear quietly.
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
    // Property invariant: a live person is readable by a name, so the pointer
    // must exist. The backfill links every person it writes (an empty
    // `full_name` still gets a birth name row with NULL text), so anything
    // else is either a half-written backfill or a hand-written person.
    name: 'primary_name_links',
    expectedSql: `SELECT 0::int AS count`,
    actualSql: `SELECT count(*)::int AS count
      FROM person
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND primary_name_id IS NULL`,
  },
  {
    // The backfill copies `deleted_at` onto the person, so the two counts must
    // match one for one. This is the only check that looks at deleted fact-layer
    // rows; it covers persons, not families or events.
    name: 'person_deleted_state',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND deleted_at IS NOT NULL`,
    actualSql: `SELECT count(*)::int AS count
      FROM person
     WHERE organization_id = $1
       AND deleted_at IS NOT NULL`,
  },
  {
    // |S|=1 → the one spouse family. |S|>1 → one family per spouse plus, only
    // when the blood node has children, the children-only family. |S|=0 with
    // children → one children-only family. Everything else contributes nothing.
    name: 'families',
    expectedSql: `SELECT coalesce(sum(
        CASE
          WHEN census.spouses = 1 THEN 1
          WHEN census.spouses > 1 THEN census.spouses
            + (CASE WHEN census.children > 0 THEN 1 ELSE 0 END)
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
    // 2·|S|, plus the blood row of the children-only family when it exists.
    // Spouse nodes are never tiered themselves and contribute no rows.
    name: 'partners',
    expectedSql: `SELECT coalesce(sum(
        CASE
          WHEN census.spouses = 1 THEN 2
          WHEN census.spouses > 1 THEN 2 * census.spouses
            + (CASE WHEN census.children > 0 THEN 1 ELSE 0 END)
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
    // Property invariant over `node` itself: a live child whose `parent_id` is
    // not a live blood node cannot be attached to any union, so the backfill
    // drops its edge and counts it in `lossReport.orphanChild`. Both
    // implementations lose the same edge, which is exactly the kind of shared
    // blind spot a count-vs-count check cannot see.
    name: 'orphan_children',
    expectedSql: `SELECT 0::int AS count`,
    actualSql: `SELECT count(*)::int AS count
      FROM node c
     WHERE c.organization_id = $1
       AND c.deleted_at IS NULL
       AND c.parent_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM node p
          WHERE p.id = c.parent_id
            AND p.organization_id = c.organization_id
            AND p.role = 'blood'
            AND p.deleted_at IS NULL)`,
  },
  {
    // A storable year gives bounds; otherwise only original text can carry the
    // fact. A placeholder year (0, 10000) with no text says nothing, so the
    // backfill writes no event at all — and `year IS NOT NULL` alone would
    // expect one. This is the check that had to change when the backfill
    // stopped inventing a contentless event for placeholders.
    name: 'birth_events',
    expectedSql: `SELECT count(*)::int AS count
      FROM node
     WHERE organization_id = $1
       AND deleted_at IS NULL
       AND (btrim(coalesce(birth_text, '')) <> ''
            OR birth_year BETWEEN 1 AND 9999)`,
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
       AND (btrim(coalesce(death_text, '')) <> ''
            OR death_year BETWEEN 1 AND 9999)`,
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
  {
    // Property invariant: every live event's subject is a live person that came
    // from a node. The backfill cannot produce a person without
    // `legacy_node_id`, and it never writes an event for a soft-deleted node,
    // so a live event hanging off such a person is a hand-written or
    // half-deleted row — visible only here, because the per-type event checks
    // count `node` and would happily agree.
    name: 'event_subjects',
    expectedSql: `SELECT 0::int AS count`,
    actualSql: `SELECT count(*)::int AS count
      FROM event e
      JOIN person p ON p.id = e.person_id
     WHERE e.organization_id = $1
       AND e.deleted_at IS NULL
       AND (p.legacy_node_id IS NULL OR p.deleted_at IS NOT NULL)`,
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
 * all checks run in one read-only repeatable-read transaction, so a row
 * committed between two checks of the same run cannot make the numbers
 * describe two different states of the organization.
 */
export async function reconcileFactLayer(
  sql: Sql,
  organizationId: string
): Promise<ReconcileReport> {
  return sql.begin('read only isolation level repeatable read', async (tx) => {
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
