import type { TransactionSql } from 'postgres';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import {
  backfillFactLayer,
  FactLayerAlreadyBackfilledError,
} from '@/lib/db/backfill/fact-layer';
import { reconcileFactLayer } from '@/lib/db/backfill/reconcile-fact-layer';
import { getTestDatabaseUrl, getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createFamily,
  createLineage,
  createNode,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

// The backfill is the only bridge from the `node` tree into the P1 fact layer,
// so this file asserts the mapping against a real database: the CHECKs the
// inserts must satisfy (five date rules in 0021, ck_node_* in the source), the
// trigger that owns the 血亲 invariant, and the non-deferrable
// fk_person_primary_name that forces the two-step person → name → UPDATE.
//
// Everything node cannot express is asserted as a *declared* loss, not as an
// invented row: a year typed into `birth_year` produces bounds but no
// `date_original`, a burial place produces `place_original` and no date, and a
// blood node carrying `spouse_of_id` (legal under ck_node_spouse_has_no_path)
// is counted in lossReport.spouseEdgeOnBloodNode instead of aborting the whole
// organization with 23514.

/** Owner of a fresh organization plus one project and one lineage in it. */
async function seedTree() {
  const user = await createUser();
  const organization = await createOrganization();
  await addMember({
    userId: user.id,
    organizationId: organization.id,
    role: 'owner',
  });
  const project = await createProject({
    orgId: organization.id,
    createdBy: user.id,
  });
  const lineage = await createLineage({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
  });
  return {
    orgId: organization.id,
    projectId: project.id,
    lineageId: lineage.id,
    createdBy: user.id,
  };
}

type EventRow = {
  event_type: string;
  event_kind: string;
  date_original: string | null;
  date_start: string | null;
  date_end: string | null;
  date_precision: string | null;
  date_qualifier: string;
  place_original: string | null;
  person_id: string;
};

async function readEvents(orgId: string, eventType: string) {
  return getTestSql()<EventRow[]>`
    SELECT event_type, event_kind, date_original,
           date_start::text AS date_start, date_end::text AS date_end,
           date_precision, date_qualifier, place_original, person_id
    FROM event
    WHERE organization_id = ${orgId} AND event_type = ${eventType}
  `;
}

async function countPersons(orgId: string): Promise<number> {
  const rows = await getTestSql()<{ count: number }[]>`
    SELECT count(*)::int AS count FROM person WHERE organization_id = ${orgId}`;
  return rows[0].count;
}

async function personIdOfNode(
  orgId: string,
  legacyNodeId: string
): Promise<string> {
  const rows = await getTestSql()<{ id: string }[]>`
    SELECT id FROM person
    WHERE organization_id = ${orgId} AND legacy_node_id = ${legacyNodeId}`;
  return rows[0].id;
}

type Scope = { orgId: string; projectId: string; createdBy: string };
type InsertTarget = { familyId: string; personId: string };

/** Two empty families plus four people, i.e. two blood inserts per family. */
async function seedFamilyPair(scope: Scope) {
  const familyA = await createFamily(scope);
  const familyB = await createFamily(scope);
  const persons: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const person = await createPerson(scope);
    persons.push(person.id);
  }
  return { familyA: familyA.id, familyB: familyB.id, persons };
}

/**
 * Both parties wait here until the other one holds its first lock, so the
 * second inserts are guaranteed to race. Without it one transaction could
 * finish before the other starts and no lock order would ever be exercised.
 */
function rendezvous() {
  let arrived = 0;
  let release: (() => void) | null = null;
  return async (): Promise<void> => {
    arrived += 1;
    if (arrived === 2) {
      release?.();
      return;
    }
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  };
}

/**
 * One transaction inserting two blood partners into two different families,
 * in the given order. app.check_family_blood_side() takes a per-family
 * advisory lock inside the trigger, so the insert order decides the lock
 * order. The whole transaction is bounded by statement_timeout: an unexpected
 * wait must fail the assertion instead of hanging the suite.
 */
async function attemptTwoFamilies(options: {
  scope: Scope;
  first: InsertTarget;
  second: InsertTarget;
  afterFirstInsert?: () => Promise<void>;
}): Promise<string | null> {
  const client = postgres(getTestDatabaseUrl(), { max: 1, onnotice: () => {} });
  const insert = (tx: TransactionSql, target: InsertTarget) => tx`
    INSERT INTO family_partner
      (organization_id, project_id, family_id, person_id, role, created_by)
    VALUES (${options.scope.orgId}, ${options.scope.projectId},
            ${target.familyId}, ${target.personId}, 'blood',
            ${options.scope.createdBy})`;
  try {
    await client.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '10s'`;
      await insert(tx, options.first);
      if (options.afterFirstInsert !== undefined) {
        await options.afterFirstInsert();
      }
      await insert(tx, options.second);
    });
    return null;
  } catch (error) {
    return pgErrorCode(error) ?? 'unknown';
  } finally {
    await client.end();
  }
}

describe('backfillFactLayer', () => {
  it('maps a tree into person, person_name, family, partner and child rows', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const founder = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '始祖',
    });
    const eldest = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: founder.id,
      name: '长子',
    });
    const second = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.b',
      parentId: founder.id,
      name: '次子',
    });
    const wife = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      role: 'spouse',
      spouseOfId: second.id,
      name: '次子妻',
    });
    const grandson = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 3,
      path: 'a.b.a',
      parentId: second.id,
      name: '孙',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    expect(result.organizationId).toBe(orgId);
    expect(result.persons).toBe(5);
    expect(result.personNames).toBe(5);
    // 始祖 has two sons and no recorded spouse → one children-only family.
    // 次子 has one spouse → one two-partner family holding the grandson.
    expect(result.families).toBe(2);
    expect(result.familyPartners).toBe(3);
    expect(result.familyChildren).toBe(3);
    expect(result.events).toBe(0);
    expect(result.lossReport).toEqual({
      unknownMother: 0,
      noMotherAtAll: 2,
      emptyFullName: 0,
      birthTextWithoutYear: 0,
      deathTextWithoutYear: 0,
      spouseEdgeOnBloodNode: 0,
      yearOutOfRange: 0,
    });

    // One person per node, keyed by legacy_node_id, and every person got a
    // primary name through the follow-up UPDATE.
    const persons = await getTestSql()<
      {
        legacy_node_id: string;
        sex: string;
        name_status: string;
        primary_name_id: string | null;
        living_status_locked: boolean;
        merged_into_id: string | null;
        sort_key: string | null;
      }[]
    >`SELECT legacy_node_id, sex, name_status, primary_name_id,
             living_status_locked, merged_into_id, sort_key
      FROM person WHERE organization_id = ${orgId}`;
    expect(persons).toHaveLength(5);
    expect(persons.map((row) => row.legacy_node_id).sort()).toEqual(
      [founder.id, eldest.id, second.id, wife.id, grandson.id].sort()
    );
    for (const person of persons) {
      expect(person.primary_name_id).not.toBeNull();
      expect(person.living_status_locked).toBe(false);
      expect(person.merged_into_id).toBeNull();
      expect(person.sort_key).toBeNull();
    }

    // A blood node is the 血亲 side and its spouse the 姻亲 side; children hang
    // off the family their parent is the blood side of.
    const partners = await getTestSql()<
      { role: string; partner_order: number; family_id: string }[]
    >`SELECT fp.role, fp.partner_order, fp.family_id
      FROM family_partner fp WHERE fp.organization_id = ${orgId}`;
    expect(partners.filter((row) => row.role === 'blood')).toHaveLength(2);
    expect(partners.filter((row) => row.role === 'spouse')).toHaveLength(1);

    const children = await getTestSql()<
      { parentage_type: string; is_primary: boolean; sort: number }[]
    >`SELECT parentage_type, is_primary, sort FROM family_child
      WHERE organization_id = ${orgId}`;
    expect(children).toHaveLength(3);
    for (const child of children) {
      expect(child.parentage_type).toBe('birth');
      expect(child.is_primary).toBe(true);
    }
  });

  it('refuses to run twice and leaves the first result untouched', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({ orgId, lineageId, createdBy, generation: 1, path: 'a' });
    await backfillFactLayer(getTestSql(), orgId);

    await expect(backfillFactLayer(getTestSql(), orgId)).rejects.toBeInstanceOf(
      FactLayerAlreadyBackfilledError
    );

    const persons = await countPersons(orgId);
    expect(persons).toBe(1);
  });

  it('hangs a child of a multi-spouse father on a children-only family', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const father = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '父',
    });
    for (const name of ['元配', '继室']) {
      await createNode({
        orgId,
        lineageId,
        createdBy,
        generation: 1,
        role: 'spouse',
        spouseOfId: father.id,
        name,
      });
    }
    const child = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: father.id,
      name: '子',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    expect(result.families).toBe(3);
    expect(result.familyPartners).toBe(5);
    expect(result.familyChildren).toBe(1);
    expect(result.lossReport.unknownMother).toBe(1);
    expect(result.lossReport.noMotherAtAll).toBe(0);

    // node does not record the mother, so the child's family carries the
    // father as its only partner — one partner row, never a guessed spouse.
    const rows = await getTestSql()<
      { person_id: string; partners: number }[]
    >`SELECT fc.person_id,
             (SELECT count(*)::int FROM family_partner fp
               WHERE fp.family_id = fc.family_id AND fp.deleted_at IS NULL) AS partners
      FROM family_child fc
      WHERE fc.organization_id = ${orgId} AND fc.person_id = (
        SELECT id FROM person WHERE legacy_node_id = ${child.id}
      )`;
    expect(rows).toHaveLength(1);
    expect(rows[0].partners).toBe(1);
  });

  it('keeps a birth text without a year as date_original only', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      birthText: '约光绪二十年',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.lossReport.birthTextWithoutYear).toBe(1);

    const [event] = await readEvents(orgId, 'birth');
    expect(event.date_original).toBe('约光绪二十年');
    expect(event.date_start).toBeNull();
    expect(event.date_end).toBeNull();
    expect(event.date_precision).toBeNull();
    expect(event.date_qualifier).toBe('unknown');
    expect(event.event_kind).toBe('event');
  });

  it('derives year bounds from birth_year and never synthesises date_original', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      birthYear: 1900,
    });

    await backfillFactLayer(getTestSql(), orgId);

    const [event] = await readEvents(orgId, 'birth');
    // A year typed into a numeric column is not original text: the year is
    // fully carried by the bounds, so date_original stays NULL.
    expect(event.date_original).toBeNull();
    expect(event.date_start).toBe('1900-01-01');
    expect(event.date_end).toBe('1900-12-31');
    expect(event.date_precision).toBe('year');
    expect(event.date_qualifier).toBe('exact');
  });

  it('keeps the original text next to the bounds when both exist', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      birthText: '光绪二十六年',
      birthYear: 1900,
    });

    await backfillFactLayer(getTestSql(), orgId);

    const [event] = await readEvents(orgId, 'birth');
    expect(event.date_original).toBe('光绪二十六年');
    expect(event.date_start).toBe('1900-01-01');
    expect(event.date_end).toBe('1900-12-31');
    expect(event.date_precision).toBe('year');
    expect(event.date_qualifier).toBe('exact');
  });

  it('degrades a placeholder birth_year of 0 instead of aborting the organization', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    // `node.birth_year` is a plain integer with no CHECK and 0 is the common
    // legacy placeholder for "unknown". One transaction covers the whole
    // organization, so throwing here would block the migration for every node.
    const placeholder = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '缺年',
      birthYear: 0,
    });
    const dated = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'b',
      name: '有年',
      birthYear: 1900,
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    // The organization commits: both people exist, and the healthy sibling
    // still gets its exact bounds.
    expect(result.persons).toBe(2);
    expect(await countPersons(orgId)).toBe(2);
    expect(result.lossReport.yearOutOfRange).toBe(1);

    const events = await readEvents(orgId, 'birth');
    expect(events).toHaveLength(2);

    const placeholderPersonId = await personIdOfNode(orgId, placeholder.id);
    const degraded = events.find(
      (row) => row.person_id === placeholderPersonId
    );
    expect(degraded).toBeDefined();
    expect(degraded?.date_qualifier).toBe('unknown');
    expect(degraded?.date_start).toBeNull();
    expect(degraded?.date_end).toBeNull();
    expect(degraded?.date_precision).toBeNull();
    // A placeholder year is not original text: date_original stays NULL.
    expect(degraded?.date_original).toBeNull();

    const datedPersonId = await personIdOfNode(orgId, dated.id);
    const healthy = events.find((row) => row.person_id === datedPersonId);
    expect(healthy?.date_start).toBe('1900-01-01');
    expect(healthy?.date_end).toBe('1900-12-31');
    expect(healthy?.date_qualifier).toBe('exact');
  });

  it('degrades a birth_year of 10000 and keeps the birth text as date_original', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const placeholder = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '逾年',
      birthYear: 10000,
      birthText: '约万历年间',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'b',
      name: '有卒年',
      isAlive: false,
      birthYear: 1900,
      deathYear: 1970,
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    expect(result.persons).toBe(2);
    expect(result.events).toBe(3);
    expect(result.lossReport.yearOutOfRange).toBe(1);

    const births = await readEvents(orgId, 'birth');
    expect(births).toHaveLength(2);
    const placeholderPersonId = await personIdOfNode(orgId, placeholder.id);
    const degraded = births.find(
      (row) => row.person_id === placeholderPersonId
    );
    // The text is original text, so it survives even though the year cannot
    // become bounds; the year itself is counted, not invented.
    expect(degraded?.date_original).toBe('约万历年间');
    expect(degraded?.date_qualifier).toBe('unknown');
    expect(degraded?.date_start).toBeNull();
    expect(degraded?.date_end).toBeNull();
    expect(degraded?.date_precision).toBeNull();

    const [death] = await readEvents(orgId, 'death');
    expect(death.date_start).toBe('1970-01-01');
  });

  it('records a burial place as a place, never as a date', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      isAlive: false,
      deathYear: 1950,
      burialPlace: '城西祖坟',
    });

    await backfillFactLayer(getTestSql(), orgId);

    const [burial] = await readEvents(orgId, 'burial');
    expect(burial.place_original).toBe('城西祖坟');
    expect(burial.date_original).toBeNull();
    expect(burial.date_start).toBeNull();
    expect(burial.date_end).toBeNull();
    expect(burial.date_qualifier).toBe('unknown');

    const [death] = await readEvents(orgId, 'death');
    expect(death.date_start).toBe('1950-01-01');
  });

  it('ignores a blank burial place', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      burialPlace: '   ',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.events).toBe(0);
    expect(await readEvents(orgId, 'burial')).toHaveLength(0);
  });

  it('keeps a soft-deleted node as a soft-deleted person and drops its edges', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const removed = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      birthYear: 1800,
      deletedAt: new Date('2020-01-01T00:00:00Z'),
    });
    const orphan = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: removed.id,
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    expect(result.persons).toBe(2);
    // A deleted node produces no family edge and no event.
    expect(result.families).toBe(0);
    expect(result.familyChildren).toBe(0);
    expect(result.events).toBe(0);

    const persons = await getTestSql()<
      { legacy_node_id: string; deleted: boolean }[]
    >`SELECT legacy_node_id, deleted_at IS NOT NULL AS deleted
      FROM person WHERE organization_id = ${orgId}`;
    const removedPerson = persons.find(
      (row) => row.legacy_node_id === removed.id
    );
    const orphanPerson = persons.find(
      (row) => row.legacy_node_id === orphan.id
    );
    expect(removedPerson?.deleted).toBe(true);
    expect(orphanPerson?.deleted).toBe(false);

    const edges = await getTestSql()<{ count: number }[]>`
      SELECT count(*)::int AS count FROM family_child
      WHERE organization_id = ${orgId}`;
    expect(edges[0].count).toBe(0);
  });

  it('adds a courtesy name row and points primary_name_id at the birth name', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const node = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '德明',
      courtesy: '子美',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.personNames).toBe(2);

    const names = await getTestSql()<
      {
        name_type: string;
        sort_order: number;
        full_name: string | null;
        given_name: string | null;
        surname: string | null;
      }[]
    >`SELECT name_type, sort_order, full_name, given_name, surname
      FROM person_name WHERE organization_id = ${orgId}
      ORDER BY sort_order`;
    expect(names.map((row) => row.name_type)).toEqual(['birth', 'courtesy']);
    expect(names.map((row) => row.sort_order)).toEqual([0, 1]);
    expect(names[0].full_name).toBe('陈德明');
    expect(names[0].given_name).toBe('德明');
    expect(names[0].surname).toBe('陈');
    expect(names[1].full_name).toBe('子美');

    const persons = await getTestSql()<
      { name_type: string; legacy_node_id: string }[]
    >`SELECT pn.name_type, p.legacy_node_id
      FROM person p JOIN person_name pn ON pn.id = p.primary_name_id
      WHERE p.organization_id = ${orgId}`;
    expect(persons).toEqual([{ name_type: 'birth', legacy_node_id: node.id }]);
  });

  it('keeps a node without a usable name as name_status unknown', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      fullName: '   ',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.lossReport.emptyFullName).toBe(1);

    const persons = await getTestSql()<{ name_status: string }[]>`
      SELECT name_status FROM person WHERE organization_id = ${orgId}`;
    expect(persons[0].name_status).toBe('unknown');

    const names = await getTestSql()<{ full_name: string | null }[]>`
      SELECT full_name FROM person_name WHERE organization_id = ${orgId}`;
    expect(names[0].full_name).toBeNull();
  });

  it('creates birth, death and burial events for a spouse node too', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const husband = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '夫',
    });
    const wife = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      role: 'spouse',
      spouseOfId: husband.id,
      name: '妻',
      birthYear: 1910,
      deathYear: 1990,
      burialPlace: '村东',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.events).toBe(3);

    const events = await getTestSql()<
      { event_type: string; person_id: string }[]
    >`SELECT event_type, person_id FROM event
      WHERE organization_id = ${orgId} ORDER BY event_type`;
    expect(events.map((row) => row.event_type)).toEqual([
      'birth',
      'burial',
      'death',
    ]);
    const wifePerson = await getTestSql()<{ id: string }[]>`
      SELECT id FROM person WHERE legacy_node_id = ${wife.id}`;
    for (const event of events) {
      expect(event.person_id).toBe(wifePerson[0].id);
    }
  });

  it('counts a blood node carrying spouse_of_id instead of aborting the backfill', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const father = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '父',
    });
    // ck_node_spouse_has_no_path permits this: role='blood' with a path and a
    // spouse edge. Treated naively it would put two blood partners in one
    // family and app.check_family_blood_side() would raise 23514, aborting the
    // whole organization.
    const son = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: father.id,
      spouseOfId: father.id,
      name: '子',
    });

    const result = await backfillFactLayer(getTestSql(), orgId);

    expect(result.lossReport.spouseEdgeOnBloodNode).toBe(1);
    expect(result.families).toBe(1);
    expect(result.familyPartners).toBe(1);
    expect(result.familyChildren).toBe(1);

    const partners = await getTestSql()<
      { role: string; person_id: string }[]
    >`SELECT fp.role, fp.person_id FROM family_partner fp
      WHERE fp.organization_id = ${orgId}`;
    expect(partners).toHaveLength(1);
    expect(partners[0].role).toBe('blood');
    const fatherPerson = await getTestSql()<{ id: string }[]>`
      SELECT id FROM person WHERE legacy_node_id = ${father.id}`;
    expect(partners[0].person_id).toBe(fatherPerson[0].id);
    // The son is a person, not silently dropped.
    const sonPerson = await getTestSql()<{ id: string }[]>`
      SELECT id FROM person WHERE legacy_node_id = ${son.id}`;
    expect(sonPerson).toHaveLength(1);
  });

  it('inserts family_partner rows in ascending family_id order', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const father = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
    });
    // Two spouses → three families, so the insert order is observable.
    for (const name of ['元配', '继室']) {
      await createNode({
        orgId,
        lineageId,
        createdBy,
        generation: 1,
        role: 'spouse',
        spouseOfId: father.id,
        name,
      });
    }

    const sql = getTestSql();
    await sql`CREATE TEMP TABLE IF NOT EXISTS tmp_partner_order (family_id uuid)`;
    await sql`TRUNCATE tmp_partner_order`;
    await sql`CREATE OR REPLACE FUNCTION tmp_log_partner_order() RETURNS trigger
              LANGUAGE plpgsql AS $$
              BEGIN
                INSERT INTO tmp_partner_order (family_id) VALUES (NEW.family_id);
                RETURN NEW;
              END $$`;
    await sql`CREATE TRIGGER trg_tmp_log_partner_order BEFORE INSERT ON family_partner
              FOR EACH ROW EXECUTE FUNCTION tmp_log_partner_order()`;
    try {
      // The whole backfill runs with a bounded statement_timeout: an unexpected
      // lock wait must fail the test instead of hanging it.
      await sql`SET statement_timeout = '10s'`;
      const result = await backfillFactLayer(sql, orgId);
      const rows = await sql<{ family_id: string }[]>`
        SELECT family_id FROM tmp_partner_order`;
      expect(rows).toHaveLength(result.familyPartners);
      const inserted = rows.map((row) => row.family_id);
      expect(inserted).toEqual([...inserted].sort());
    } finally {
      await sql`RESET statement_timeout`;
      await sql`DROP TRIGGER IF EXISTS trg_tmp_log_partner_order ON family_partner`;
      await sql`DROP FUNCTION IF EXISTS tmp_log_partner_order()`;
    }
  });

  it('deadlocks on opposite family order and rejects the second writer in family_id order', async () => {
    const { orgId, projectId, createdBy } = await seedTree();
    const scope: Scope = { orgId, projectId, createdBy };

    // Opposite order: each transaction holds its first family's advisory lock
    // and then waits for the other's. This is the shape
    // app.check_family_blood_side() creates when two multi-family writers
    // disagree on the order, and PostgreSQL resolves it with 40P01.
    const opposite = await seedFamilyPair(scope);
    const bothArrived = rendezvous();
    const [left, right] = await Promise.all([
      attemptTwoFamilies({
        scope,
        first: { familyId: opposite.familyA, personId: opposite.persons[0] },
        second: { familyId: opposite.familyB, personId: opposite.persons[1] },
        afterFirstInsert: bothArrived,
      }),
      attemptTwoFamilies({
        scope,
        first: { familyId: opposite.familyB, personId: opposite.persons[2] },
        second: { familyId: opposite.familyA, personId: opposite.persons[3] },
        afterFirstInsert: bothArrived,
      }),
    ]);
    // Exactly one side wins, the other is the deadlock victim.
    expect([left, right].filter((code) => code === null)).toHaveLength(1);
    expect([left, right].filter((code) => code === '40P01')).toHaveLength(1);

    // Fresh families, both transactions in ascending family_id order: the
    // second writer waits on the first family's lock and is then rejected by
    // the blood-side rule instead of deadlocking.
    const ordered = await seedFamilyPair(scope);
    const [ascending, waiting] = await Promise.all([
      attemptTwoFamilies({
        scope,
        first: { familyId: ordered.familyA, personId: ordered.persons[0] },
        second: { familyId: ordered.familyB, personId: ordered.persons[1] },
      }),
      attemptTwoFamilies({
        scope,
        first: { familyId: ordered.familyA, personId: ordered.persons[2] },
        second: { familyId: ordered.familyB, personId: ordered.persons[3] },
      }),
    ]);
    expect([ascending, waiting].filter((code) => code === null)).toHaveLength(
      1
    );
    expect(
      [ascending, waiting].filter((code) => code === '23514')
    ).toHaveLength(1);
  });

  it('writes two families with two partners each in one transaction without deadlocking', async () => {
    const { orgId, projectId, createdBy } = await seedTree();
    const scope: Scope = { orgId, projectId, createdBy };
    const persons: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const person = await createPerson(scope);
      persons.push(person.id);
    }
    const sql = getTestSql();

    // Families created in the order B, A and filled in the order A, B: one
    // transaction cannot deadlock with itself because the advisory lock is
    // re-entrant per transaction, so what this case proves is that the
    // opposite-order shape completes under a bounded statement_timeout and
    // leaves both families with their two partners. The two-connection case
    // above is what proves the hazard is real.
    await sql.begin(async (tx) => {
      await tx`SET LOCAL statement_timeout = '10s'`;
      const familyB = await tx<{ id: string }[]>`
        INSERT INTO family (organization_id, project_id, created_by)
        VALUES (${orgId}, ${projectId}, ${createdBy}) RETURNING id`;
      const familyA = await tx<{ id: string }[]>`
        INSERT INTO family (organization_id, project_id, created_by)
        VALUES (${orgId}, ${projectId}, ${createdBy}) RETURNING id`;
      const rows: { familyId: string; personId: string; role: string }[] = [
        { familyId: familyA[0].id, personId: persons[0], role: 'blood' },
        { familyId: familyA[0].id, personId: persons[1], role: 'spouse' },
        { familyId: familyB[0].id, personId: persons[2], role: 'blood' },
        { familyId: familyB[0].id, personId: persons[3], role: 'spouse' },
      ];
      for (const row of rows) {
        await tx`INSERT INTO family_partner
                   (organization_id, project_id, family_id, person_id, role, created_by)
                 VALUES (${orgId}, ${projectId}, ${row.familyId},
                         ${row.personId}, ${row.role}, ${createdBy})`;
      }
    });

    const rows = await getTestSql()<{ family_id: string; count: number }[]>`
      SELECT family_id, count(*)::int AS count FROM family_partner
      WHERE organization_id = ${orgId} GROUP BY family_id`;
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.count).toBe(2);
    }
  });
});

// The brief's case 2: the zero-diff gate. It lives here rather than in
// fact-reconcile.test.ts because it is the backfill's own acceptance test — the
// round trip is only meaningful against the trees the cases above seed. The
// reconciliation shares no code with the backfill (see that module's header),
// so the agreement is between two independent implementations.
describe('reconcileFactLayer', () => {
  it('reports no diff against node and covers all ten checks', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const founder = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '始祖',
      courtesy: '子美',
      birthText: '光绪二十六年庚子',
      birthYear: 1900,
      deathText: '庚戌年',
      deathYear: 1970,
      burialPlace: '村东祖坟',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      role: 'spouse',
      spouseOfId: founder.id,
      name: '始祖配',
      birthYear: 1904,
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: founder.id,
      name: '长子',
      birthYear: 1930,
    });
    // Soft-deleted nodes still have a person and a birth name, but no family,
    // child edge or event: the reconciliation's two scopes in one tree.
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'b',
      name: '已删',
      birthYear: 1880,
      deletedAt: new Date('2020-01-01T00:00:00Z'),
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.persons).toBe(4);
    expect(result.families).toBe(1);
    expect(result.familyPartners).toBe(2);
    expect(result.familyChildren).toBe(1);
    expect(result.events).toBe(5);

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.organizationId).toBe(orgId);
    expect(report.diffs).toEqual([]);
    expect([...report.checked].sort()).toEqual([
      'birth_events',
      'burial_events',
      'child_edges',
      'contentless_events',
      'courtesy_names',
      'death_events',
      'families',
      'partners',
      'persons',
      'primary_names',
    ]);
  });
});
