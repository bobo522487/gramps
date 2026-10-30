import type { Sql, TransactionSql } from 'postgres';
import {
  emptyLossReport,
  type FamilyPlan,
  type LiveNode,
  type LossReport,
  personIdOf,
  planEvents,
  planFamilies,
} from './fact-layer-rules';

export type { LossReport } from './fact-layer-rules';

// The one-way bridge from `node` into the P1 fact layer: one transaction per
// organization, never writes back to `node`. Mapping rules: fact-layer-rules.

export type BackfillResult = {
  organizationId: string;
  persons: number;
  personNames: number;
  families: number;
  familyPartners: number;
  familyChildren: number;
  events: number;
  lossReport: LossReport;
};

export class FactLayerAlreadyBackfilledError extends Error {
  constructor(organizationId: string) {
    super(`organization ${organizationId} already has fact-layer person rows`);
    this.name = 'FactLayerAlreadyBackfilledError';
  }
}

type PartnerRow = {
  organization_id: string;
  project_id: string;
  family_id: string;
  person_id: string;
  role: string;
  partner_order: number;
  created_by: string;
};

type ChildRow = {
  organization_id: string;
  project_id: string;
  family_id: string;
  person_id: string;
  parentage_type: string;
  is_primary: boolean;
  sort: number;
  created_by: string;
};

/** The pre-check: this is the only re-run guard, so it must share the tx. */
async function lockOrganization(
  tx: TransactionSql,
  organizationId: string
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) {
    throw new Error(`organization ${organizationId} not found`);
  }
  const persons = await tx<{ count: number }[]>`
    SELECT count(*)::int AS count FROM person
    WHERE organization_id = ${organizationId}`;
  if (persons[0].count > 0) {
    throw new FactLayerAlreadyBackfilledError(organizationId);
  }
}

/** Step 1: one person per node, including soft-deleted nodes. */
async function insertPersons(
  tx: TransactionSql,
  organizationId: string
): Promise<{ id: string; legacy_node_id: string }[]> {
  return tx<{ id: string; legacy_node_id: string }[]>`
    INSERT INTO person (
      organization_id, project_id, sex, living_status, privacy_level,
      name_status, legacy_node_id, created_by, deleted_at
    )
    SELECT
      n.organization_id,
      l.project_id,
      CASE WHEN n.sex = 0 THEN 'male' ELSE 'female' END,
      CASE WHEN n.is_alive THEN 'living' ELSE 'deceased' END,
      CASE WHEN n.is_alive THEN 'private' ELSE 'public' END,
      CASE WHEN btrim(n.full_name) = '' THEN 'unknown' ELSE 'known' END,
      n.id,
      n.created_by,
      n.deleted_at
    FROM node n
    JOIN lineage l
      ON l.id = n.lineage_id AND l.organization_id = n.organization_id
    WHERE n.organization_id = ${organizationId}
    RETURNING id, legacy_node_id`;
}

/** Step 2a: the birth name of every node, plus a courtesy name when present. */
async function insertPersonNames(
  tx: TransactionSql,
  organizationId: string
): Promise<number> {
  const birthNames = await tx<{ id: string }[]>`
    INSERT INTO person_name (
      organization_id, project_id, person_id, name_type, full_name, surname,
      given_name, name_prefix, sort_order, created_by, deleted_at
    )
    SELECT
      p.organization_id,
      p.project_id,
      p.id,
      'birth',
      CASE WHEN btrim(n.full_name) = '' THEN NULL ELSE n.full_name END,
      n.surname,
      n.name,
      n.name_prefix,
      0,
      n.created_by,
      n.deleted_at
    FROM node n
    JOIN person p
      ON p.organization_id = n.organization_id AND p.legacy_node_id = n.id
    WHERE n.organization_id = ${organizationId}
    RETURNING id`;
  const courtesyNames = await tx<{ id: string }[]>`
    INSERT INTO person_name (
      organization_id, project_id, person_id, name_type, full_name, sort_order,
      created_by, deleted_at
    )
    SELECT
      p.organization_id, p.project_id, p.id, 'courtesy', n.courtesy, 1,
      n.created_by, n.deleted_at
    FROM node n
    JOIN person p
      ON p.organization_id = n.organization_id AND p.legacy_node_id = n.id
    WHERE n.organization_id = ${organizationId}
      AND btrim(coalesce(n.courtesy, '')) <> ''
    RETURNING id`;
  return birthNames.length + courtesyNames.length;
}

/**
 * Step 2b: point person.primary_name_id at the birth name. This cannot happen
 * in the INSERT: fk_person_primary_name is not deferrable, so the name row
 * must exist before the person can reference it.
 */
async function linkPrimaryNames(
  tx: TransactionSql,
  organizationId: string
): Promise<void> {
  await tx`
    UPDATE person p
    SET primary_name_id = pn.id
    FROM person_name pn
    WHERE p.organization_id = ${organizationId}
      AND pn.organization_id = p.organization_id
      AND pn.person_id = p.id
      AND pn.name_type = 'birth'
      AND pn.sort_order = 0`;
}

async function readLiveNodes(
  tx: TransactionSql,
  organizationId: string
): Promise<LiveNode[]> {
  return tx<LiveNode[]>`
    SELECT
      n.id, l.project_id, n.parent_id, n.spouse_of_id, n.role, n.sort,
      n.name, n.surname, n.full_name, n.sex, n.courtesy, n.name_prefix,
      n.is_alive, n.birth_text, n.death_text, n.birth_year, n.death_year,
      n.burial_place, n.created_by
    FROM node n
    JOIN lineage l
      ON l.id = n.lineage_id AND l.organization_id = n.organization_id
    WHERE n.organization_id = ${organizationId} AND n.deleted_at IS NULL
    ORDER BY n.id`;
}

type Cell = string | number | boolean | null;

/**
 * Multi-row insert. `statement` is a literal prefix built from this module's
 * constants, never from node data; every value is a bind parameter.
 */
async function insertRows<Row extends Record<string, Cell>>(
  tx: TransactionSql,
  statement: string,
  columns: string[],
  rows: Row[]
): Promise<void> {
  const chunkSize = 500;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const placeholders = chunk
      .map(
        (_, rowIndex) =>
          `(${columns
            .map(
              (_, columnIndex) =>
                `$${rowIndex * columns.length + columnIndex + 1}`
            )
            .join(', ')})`
      )
      .join(', ');
    const parameters = chunk.flatMap((row) =>
      columns.map((column) => row[column])
    );
    await tx.unsafe(`${statement} VALUES ${placeholders}`, parameters);
  }
}

/**
 * Step 3 (continued): create the families and their partner/child rows.
 *
 * app.check_family_blood_side() takes a per-family advisory lock inside the
 * family_partner trigger, so two transactions that insert several families in
 * different orders deadlock. Every writer therefore inserts in ascending
 * family_id order, one family at a time: a single INSERT ... SELECT ... ORDER BY
 * does not promise anything about the order the trigger fires in.
 */
async function writeFamilies(
  tx: TransactionSql,
  organizationId: string,
  plans: FamilyPlan[],
  personIdByNodeId: Map<string, string>
): Promise<{ families: number; partners: number; children: number }> {
  const created: { familyId: string; plan: FamilyPlan }[] = [];
  for (const plan of plans) {
    const rows = await tx<{ id: string }[]>`
      INSERT INTO family (organization_id, project_id, created_by)
      VALUES (${organizationId}, ${plan.blood.project_id},
              ${plan.blood.created_by})
      RETURNING id`;
    created.push({ familyId: rows[0].id, plan });
  }
  created.sort((left, right) =>
    left.familyId < right.familyId ? -1 : left.familyId > right.familyId ? 1 : 0
  );

  let partners = 0;
  let children = 0;
  for (const { familyId, plan } of created) {
    const partnerRows: PartnerRow[] = [
      {
        organization_id: organizationId,
        project_id: plan.blood.project_id,
        family_id: familyId,
        person_id: personIdOf(personIdByNodeId, plan.blood.id),
        role: 'blood',
        partner_order: 1,
        created_by: plan.blood.created_by,
      },
    ];
    if (plan.spouse !== null) {
      partnerRows.push({
        organization_id: organizationId,
        project_id: plan.spouse.project_id,
        family_id: familyId,
        person_id: personIdOf(personIdByNodeId, plan.spouse.id),
        role: 'spouse',
        partner_order: 1,
        created_by: plan.spouse.created_by,
      });
    }
    await insertRows(
      tx,
      `INSERT INTO family_partner (${PARTNER_COLUMNS.join(', ')})`,
      PARTNER_COLUMNS,
      partnerRows
    );
    partners += partnerRows.length;

    if (plan.children.length > 0) {
      const childRows: ChildRow[] = plan.children.map((child) => ({
        organization_id: organizationId,
        project_id: child.project_id,
        family_id: familyId,
        person_id: personIdOf(personIdByNodeId, child.id),
        parentage_type: 'birth',
        is_primary: true,
        sort: child.sort ?? 0,
        created_by: child.created_by,
      }));
      await insertRows(
        tx,
        `INSERT INTO family_child (${CHILD_COLUMNS.join(', ')})`,
        CHILD_COLUMNS,
        childRows
      );
      children += childRows.length;
    }
  }
  return { families: created.length, partners, children };
}

const PARTNER_COLUMNS = [
  'organization_id',
  'project_id',
  'family_id',
  'person_id',
  'role',
  'partner_order',
  'created_by',
];

const CHILD_COLUMNS = [
  'organization_id',
  'project_id',
  'family_id',
  'person_id',
  'parentage_type',
  'is_primary',
  'sort',
  'created_by',
];

const EVENT_COLUMNS = [
  'organization_id',
  'project_id',
  'person_id',
  'event_type',
  'date_original',
  'date_start',
  'date_end',
  'date_precision',
  'date_qualifier',
  'place_original',
  'created_by',
];

/**
 * Move one organization's `node` rows into the fact layer, in one transaction. If the organization already has any person row
 * it throws FactLayerAlreadyBackfilledError and rolls back: that pre-check is
 * the only re-run guard, because `event` deliberately has no idempotency key
 * (one node yields zero to three events, so no natural unique key exists).
 */
export async function backfillFactLayer(
  sql: Sql,
  organizationId: string
): Promise<BackfillResult> {
  return sql.begin(async (tx) => {
    await lockOrganization(tx, organizationId);

    const persons = await insertPersons(tx, organizationId);
    const personIdByNodeId = new Map(
      persons.map((row) => [row.legacy_node_id, row.id])
    );
    const personNames = await insertPersonNames(tx, organizationId);
    await linkPrimaryNames(tx, organizationId);

    const lossReport = emptyLossReport();
    // Two content losses over the same rows: a blank full_name (stored as
    // name_status='unknown') and biography, which has no P1 column at all.
    const [content] = await tx<{ empty: number; biographies: number }[]>`
      SELECT count(*) FILTER (WHERE btrim(full_name) = '')::int AS empty,
             count(*) FILTER (WHERE btrim(coalesce(biography, '')) <> '')::int AS biographies
        FROM node WHERE organization_id = ${organizationId}`;
    lossReport.emptyFullName = content.empty;
    lossReport.biographyDropped = content.biographies;

    const nodes = await readLiveNodes(tx, organizationId);
    const plans = planFamilies(nodes, lossReport);
    const written = await writeFamilies(
      tx,
      organizationId,
      plans,
      personIdByNodeId
    );

    const events = planEvents(
      organizationId,
      nodes,
      personIdByNodeId,
      lossReport
    );
    if (events.length > 0) {
      await insertRows(
        tx,
        `INSERT INTO event (${EVENT_COLUMNS.join(', ')})`,
        EVENT_COLUMNS,
        events
      );
    }

    return {
      organizationId,
      persons: persons.length,
      personNames,
      families: written.families,
      familyPartners: written.partners,
      familyChildren: written.children,
      events: events.length,
      lossReport,
    };
  });
}
