import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';
import { backfillFactLayer } from '@/lib/db/backfill/fact-layer';
import { reconcileFactLayer } from '@/lib/db/backfill/reconcile-fact-layer';
import { getTestSql } from '../helpers/db';
import {
  addMember,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

// The reconciliation is the *other* implementation of the backfill's contract:
// it recomputes every expectation from `node` with its own SQL and compares the
// counts with what the backfill actually wrote. It deliberately imports nothing
// from lib/db/backfill/fact-layer.ts or fact-layer-rules.ts, so these tests are
// the only place the two implementations meet.
//
// A clean tree must report zero diffs; a hand-made divergence must be caught.
// Both directions matter: a reconciliation that always said "ok" would pass the
// first test alone.

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

const CHECK_NAMES = [
  'birth_events',
  'burial_events',
  'child_edges',
  'contentless_events',
  'courtesy_names',
  'death_events',
  'event_subjects',
  'families',
  'orphan_children',
  'partners',
  'person_deleted_state',
  'persons',
  'primary_name_links',
  'primary_names',
];

describe('reconcileFactLayer', () => {
  it('reports no diff for a tree with every shape the backfill tiers', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    // A father with two recorded spouses: one family per spouse plus a
    // children-only family for the children whose mother is unknown.
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
      name: '元配',
      birthYear: 1904,
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      role: 'spouse',
      spouseOfId: founder.id,
      name: '继配',
      birthYear: 1908,
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
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.b',
      parentId: founder.id,
      name: '次子',
    });
    // A father with no recorded spouse but a child: one children-only family.
    const loneFather = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'b',
      name: '旁支',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'b.a',
      parentId: loneFather.id,
      name: '旁支子',
    });
    // Soft-deleted: still gets a person and a birth name (deleted_at copied),
    // but no family, no child edge and no event — even though it carries a
    // birth year, which is what proves the event checks are live-node only.
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'c',
      name: '已删',
      birthYear: 1880,
      deletedAt: new Date('2020-01-01T00:00:00Z'),
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    // The tree is non-trivial on every axis, so a zero-diff report below is a
    // real agreement and not two zeros meeting.
    expect(result.persons).toBe(8);
    expect(result.personNames).toBe(9);
    expect(result.families).toBe(4);
    expect(result.familyPartners).toBe(6);
    expect(result.familyChildren).toBe(3);
    expect(result.events).toBe(6);

    const report = await reconcileFactLayer(getTestSql(), orgId);

    expect(report.organizationId).toBe(orgId);
    expect(report.diffs).toEqual([]);
    expect([...report.checked].sort()).toEqual(CHECK_NAMES);
  });

  it('catches a family_child soft-deleted behind the backfill', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const father = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '父',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      role: 'spouse',
      spouseOfId: father.id,
      name: '母',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: father.id,
      name: '子',
    });

    await backfillFactLayer(getTestSql(), orgId);
    // A clean tree first: the divergence below must be the only reason for the
    // diff that follows.
    expect((await reconcileFactLayer(getTestSql(), orgId)).diffs).toEqual([]);

    // node still says "the child has a parent"; only the fact-layer row is
    // gone, so the expected edge count stays 1 and the actual drops to 0.
    await getTestSql()`
      UPDATE family_child SET deleted_at = now() WHERE organization_id = ${orgId}`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'child_edges', expected: 1, actual: 0 },
    ]);
  });

  it('catches a contentless event written straight into the table', async () => {
    const { orgId, projectId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
      birthYear: 1900,
    });
    await backfillFactLayer(getTestSql(), orgId);

    const person = await getTestSql()<{ id: string }[]>`
      SELECT id FROM person WHERE organization_id = ${orgId}`;
    // Legal in the schema, meaningless as a fact: a subject, a type, and
    // nothing else. The Task 6 review found this row shape; the tenth check
    // exists so it cannot land unnoticed.
    await getTestSql()`
      INSERT INTO event (organization_id, project_id, created_by, person_id,
                         event_type)
      VALUES (${orgId}, ${projectId}, ${createdBy}, ${person[0].id}, 'event')`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'contentless_events', expected: 0, actual: 1 },
    ]);
  });

  it('catches a live person with no primary name', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
    });
    await backfillFactLayer(getTestSql(), orgId);
    expect((await reconcileFactLayer(getTestSql(), orgId)).diffs).toEqual([]);

    // Legal (the column is nullable) but unreadable: a person the UI can never
    // show by name. Nothing else in the fact layer changes, so only the
    // property check can see it.
    await getTestSql()`
      UPDATE person SET primary_name_id = NULL WHERE organization_id = ${orgId}`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'primary_name_links', expected: 0, actual: 1 },
    ]);
  });

  it('catches a person soft-deleted behind the backfill', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
    });
    await backfillFactLayer(getTestSql(), orgId);
    expect((await reconcileFactLayer(getTestSql(), orgId)).diffs).toEqual([]);

    // The backfill copies `deleted_at` from the node, so one deleted person
    // with zero deleted nodes is a diff. The node-side counts cannot see this
    // at all: `persons` still matches.
    await getTestSql()`
      UPDATE person SET deleted_at = now() WHERE organization_id = ${orgId}`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'person_deleted_state', expected: 0, actual: 1 },
    ]);
  });

  it('catches a live event whose subject came from no node', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
      birthYear: 1900,
    });
    await backfillFactLayer(getTestSql(), orgId);
    expect((await reconcileFactLayer(getTestSql(), orgId)).diffs).toEqual([]);

    // A person without a node anchor has no source in P1: the birth event
    // still exists and `birth_events` still agrees, so only this check can
    // report the orphaned subject.
    await getTestSql()`
      UPDATE person SET legacy_node_id = NULL WHERE organization_id = ${orgId}`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'event_subjects', expected: 0, actual: 1 },
    ]);
  });

  it('catches a child whose parent is not a live blood node', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    const father = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '父',
    });
    const mother = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      role: 'spouse',
      spouseOfId: father.id,
      name: '母',
    });
    const child = await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 2,
      path: 'a.a',
      parentId: father.id,
      name: '子',
    });
    await backfillFactLayer(getTestSql(), orgId);
    expect((await reconcileFactLayer(getTestSql(), orgId)).diffs).toEqual([]);

    // `parent_id` may point at any node of the lineage, a spouse node included,
    // and the backfill cannot express that parent: the child edge is dropped.
    // The edge is dropped here too, so `child_edges` stays consistent and the
    // property check is the only one that fires — the loss is real either way.
    await getTestSql()`
      UPDATE node SET parent_id = ${mother.id} WHERE id = ${child.id}`;
    await getTestSql()`
      UPDATE family_child SET deleted_at = now() WHERE organization_id = ${orgId}`;

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([
      { check: 'orphan_children', expected: 0, actual: 1 },
    ]);
  });

  it('expects no event for a placeholder year that has no original text', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    // `birth_year = 0` is the common legacy placeholder for "unknown". With no
    // text either, the node says nothing about a birth: the backfill must not
    // invent an event, and this expectation has to agree, or every imported
    // tree with placeholders reports a phantom diff.
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '缺年',
      birthYear: 0,
    });
    // The same unstorable year *with* text is a fact: the text survives as
    // date_original, so this node does produce an event.
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'b',
      name: '缺年有文',
      birthYear: 0,
      birthText: '约清末',
    });
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'c',
      name: '有年',
      birthYear: 1900,
    });

    const result = await backfillFactLayer(getTestSql(), orgId);
    expect(result.lossReport.yearOutOfRange).toBe(2);
    expect(result.events).toBe(2);

    const report = await reconcileFactLayer(getTestSql(), orgId);
    expect(report.diffs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// One deliberate divergence per check.
//
// The tests above prove the gate catches the three shapes someone already
// thought of. They cannot prove it catches the *other* eleven: deleting a check
// makes the clean-tree test fail (fourteen names become thirteen), but
// *weakening* one — `birth_year IS NOT NULL` instead of the C1 rule, say —
// passes every one of them. This table is the missing half. Each row mutates
// the fact layer in a way that is legal under every constraint and asserts that
// exactly one check notices, then undoes it and asserts the organization is
// clean again. A check that fires on everything would fail the first
// assertion; a check that fires on nothing fails the second.
// ---------------------------------------------------------------------------

type DivergenceContext = {
  orgId: string;
  projectId: string;
  createdBy: string;
  fatherNode: string;
  sonNode: string;
  wifeNode: string;
  daughterNode: string;
  placeholderNode: string;
};

type Divergence = {
  check: string;
  /** Applies the divergence and returns its undo. */
  apply: (
    tx: Sql,
    ctx: DivergenceContext
  ) => Promise<(tx: Sql) => Promise<void>>;
};

/**
 * Father (birth 1900 + burial place), his son, daughter and a placeholder-year
 * child (year 0, no text), and the son's wife (death 1980): two families (the
 * father's children-only union and the son's marriage), three partners, three
 * child edges, three events.
 *
 * The placeholder child is the point of the seed: it is the one node whose
 * backfill and expectation disagreed (C1), so a weakened `birth_events`
 * expectation fails the baseline assertion below on every row of the table
 * rather than only on the row that deletes a birth event.
 */
async function seedDivergenceTree(): Promise<DivergenceContext> {
  const { orgId, projectId, lineageId, createdBy } = await seedTree();
  const father = await createNode({
    orgId,
    lineageId,
    createdBy,
    generation: 1,
    path: 'a',
    name: '父',
    birthYear: 1900,
    burialPlace: '祖坟',
  });
  const son = await createNode({
    orgId,
    lineageId,
    createdBy,
    parentId: father.id,
    generation: 2,
    path: 'a.a',
    name: '子',
  });
  const wife = await createNode({
    orgId,
    lineageId,
    createdBy,
    spouseOfId: son.id,
    role: 'spouse',
    generation: 2,
    name: '媳',
    sex: 0,
    deathYear: 1980,
  });
  const daughter = await createNode({
    orgId,
    lineageId,
    createdBy,
    parentId: father.id,
    generation: 2,
    path: 'a.b',
    name: '女',
    sex: 0,
  });
  // Year 0 with no original text: the backfill writes no event for it, and the
  // expectation must agree (see the C1 note in reconcile-fact-layer.ts).
  const placeholder = await createNode({
    orgId,
    lineageId,
    createdBy,
    parentId: father.id,
    generation: 2,
    path: 'a.c',
    name: '殇',
    birthYear: 0,
  });
  return {
    orgId,
    projectId,
    createdBy,
    fatherNode: father.id,
    sonNode: son.id,
    wifeNode: wife.id,
    daughterNode: daughter.id,
    placeholderNode: placeholder.id,
  };
}

async function personOfNode(
  tx: Sql,
  orgId: string,
  nodeId: string
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM person
     WHERE organization_id = ${orgId} AND legacy_node_id = ${nodeId}`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`no person for node ${nodeId}`);
  }
  return row.id;
}

/** The family whose blood partner is `personId` (the backfill writes one). */
async function familyOfBloodPerson(
  tx: Sql,
  orgId: string,
  personId: string
): Promise<string> {
  const rows = await tx<{ family_id: string }[]>`
    SELECT family_id FROM family_partner
     WHERE organization_id = ${orgId}
       AND person_id = ${personId}
       AND role = 'blood'
       AND deleted_at IS NULL`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`no family for blood person ${personId}`);
  }
  return row.family_id;
}

async function eventOfPerson(
  tx: Sql,
  personId: string,
  eventType: string
): Promise<string> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM event
     WHERE person_id = ${personId}
       AND event_type = ${eventType}
       AND deleted_at IS NULL`;
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`no ${eventType} event for person ${personId}`);
  }
  return row.id;
}

const DIVERGENCES: Divergence[] = [
  {
    check: 'persons',
    // A person whose only name is not a birth name: a birth name row would
    // move `primary_names` as well, and `primary_name_links` requires a
    // pointer, so the name has to exist and has to be `other`.
    apply: async (tx, ctx) => {
      const [person] = await tx<{ id: string }[]>`
        INSERT INTO person
          (organization_id, project_id, sex, living_status, privacy_level,
           name_status, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, 'unknown', 'unknown', 'private',
                'known', ${ctx.createdBy})
        RETURNING id`;
      const [name] = await tx<{ id: string }[]>`
        INSERT INTO person_name
          (organization_id, project_id, person_id, name_type, custom_type,
           sort_order, full_name, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${person!.id}, 'other', 'alias',
                0, '外姓人', ${ctx.createdBy})
        RETURNING id`;
      await tx`
        UPDATE person SET primary_name_id = ${name!.id} WHERE id = ${person!.id}`;
      return async (undo) => {
        await undo`UPDATE person SET primary_name_id = NULL WHERE id = ${person!.id}`;
        await undo`DELETE FROM person_name WHERE id = ${name!.id}`;
        await undo`DELETE FROM person WHERE id = ${person!.id}`;
      };
    },
  },
  {
    check: 'primary_names',
    // A second birth name (a 曾用名 is legal): `uk_person_name_type_order`
    // allows it at another sort order, and only the birth-name count moves.
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const [name] = await tx<{ id: string }[]>`
        INSERT INTO person_name
          (organization_id, project_id, person_id, name_type, sort_order,
           full_name, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${personId}, 'birth', 1,
                '陈曾用', ${ctx.createdBy})
        RETURNING id`;
      return async (undo) => {
        await undo`DELETE FROM person_name WHERE id = ${name!.id}`;
      };
    },
  },
  {
    check: 'courtesy_names',
    // No node carries `courtesy`, so any courtesy name row is a diff.
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const [name] = await tx<{ id: string }[]>`
        INSERT INTO person_name
          (organization_id, project_id, person_id, name_type, sort_order,
           full_name, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${personId}, 'courtesy', 0,
                '子安', ${ctx.createdBy})
        RETURNING id`;
      return async (undo) => {
        await undo`DELETE FROM person_name WHERE id = ${name!.id}`;
      };
    },
  },
  {
    check: 'primary_name_links',
    // The pointer the backfill always sets; clearing it is legal (the FK is
    // nullable) and makes the person unreadable by name.
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const [before] = await tx<{ primary_name_id: string }[]>`
        SELECT primary_name_id FROM person WHERE id = ${personId}`;
      await tx`UPDATE person SET primary_name_id = NULL WHERE id = ${personId}`;
      return async (undo) => {
        await undo`UPDATE person SET primary_name_id = ${before!.primary_name_id}
                    WHERE id = ${personId}`;
      };
    },
  },
  {
    check: 'person_deleted_state',
    // Soft-deleting a person whose node is live: legal (soft delete is the only
    // delete), invisible to `persons` (which counts deleted rows too) and to
    // `event_subjects` (the daughter has no event).
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.daughterNode);
      await tx`UPDATE person SET deleted_at = now() WHERE id = ${personId}`;
      return async (undo) => {
        await undo`UPDATE person SET deleted_at = NULL WHERE id = ${personId}`;
      };
    },
  },
  {
    check: 'families',
    // A union with no partners and no children: the schema allows it (the
    // "at least one blood partner" rule is a trigger on partners, not on the
    // family), so only the family count moves.
    apply: async (tx, ctx) => {
      const [family] = await tx<{ id: string }[]>`
        INSERT INTO family (organization_id, project_id, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${ctx.createdBy})
        RETURNING id`;
      return async (undo) => {
        await undo`DELETE FROM family WHERE id = ${family!.id}`;
      };
    },
  },
  {
    check: 'partners',
    // A second spouse partner on the father's children-only family: legal
    // (the trigger only rejects a second *blood* partner), and it moves the
    // partner count without adding a family or a child.
    apply: async (tx, ctx) => {
      const fatherPerson = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const wifePerson = await personOfNode(tx, ctx.orgId, ctx.wifeNode);
      const familyId = await familyOfBloodPerson(tx, ctx.orgId, fatherPerson);
      const [partner] = await tx<{ id: string }[]>`
        INSERT INTO family_partner
          (organization_id, project_id, family_id, person_id, role,
           partner_order, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${familyId}, ${wifePerson},
                'spouse', 2, ${ctx.createdBy})
        RETURNING id`;
      return async (undo) => {
        await undo`DELETE FROM family_partner WHERE id = ${partner!.id}`;
      };
    },
  },
  {
    check: 'child_edges',
    // Soft-deleting one child edge: the family stays, so only the edge count
    // moves.
    apply: async (tx, ctx) => {
      const daughterPerson = await personOfNode(
        tx,
        ctx.orgId,
        ctx.daughterNode
      );
      const [edge] = await tx<{ id: string }[]>`
        SELECT id FROM family_child
         WHERE organization_id = ${ctx.orgId} AND person_id = ${daughterPerson}
           AND deleted_at IS NULL`;
      await tx`UPDATE family_child SET deleted_at = now() WHERE id = ${edge!.id}`;
      return async (undo) => {
        await undo`UPDATE family_child SET deleted_at = NULL WHERE id = ${edge!.id}`;
      };
    },
  },
  {
    check: 'orphan_children',
    // Repointing the daughter's `parent_id` at a spouse node makes her an
    // orphan for the backfill's purposes. The edge has to go with it, or
    // `child_edges` would report the same row — and the pair is exactly what
    // the check exists for: both implementations drop the edge, and only the
    // node-side property check can see the child.
    apply: async (tx, ctx) => {
      const daughterPerson = await personOfNode(
        tx,
        ctx.orgId,
        ctx.daughterNode
      );
      const [edge] = await tx<{ id: string }[]>`
        SELECT id FROM family_child
         WHERE organization_id = ${ctx.orgId} AND person_id = ${daughterPerson}
           AND deleted_at IS NULL`;
      await tx`UPDATE node SET parent_id = ${ctx.wifeNode}
                WHERE id = ${ctx.daughterNode}`;
      await tx`UPDATE family_child SET deleted_at = now() WHERE id = ${edge!.id}`;
      return async (undo) => {
        await undo`UPDATE node SET parent_id = ${ctx.fatherNode}
                    WHERE id = ${ctx.daughterNode}`;
        await undo`UPDATE family_child SET deleted_at = NULL WHERE id = ${edge!.id}`;
      };
    },
  },
  {
    check: 'birth_events',
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const eventId = await eventOfPerson(tx, personId, 'birth');
      await tx`UPDATE event SET deleted_at = now() WHERE id = ${eventId}`;
      return async (undo) => {
        await undo`UPDATE event SET deleted_at = NULL WHERE id = ${eventId}`;
      };
    },
  },
  {
    check: 'death_events',
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.wifeNode);
      const eventId = await eventOfPerson(tx, personId, 'death');
      await tx`UPDATE event SET deleted_at = now() WHERE id = ${eventId}`;
      return async (undo) => {
        await undo`UPDATE event SET deleted_at = NULL WHERE id = ${eventId}`;
      };
    },
  },
  {
    check: 'burial_events',
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const eventId = await eventOfPerson(tx, personId, 'burial');
      await tx`UPDATE event SET deleted_at = now() WHERE id = ${eventId}`;
      return async (undo) => {
        await undo`UPDATE event SET deleted_at = NULL WHERE id = ${eventId}`;
      };
    },
  },
  {
    check: 'contentless_events',
    // A subject-only `census` event: every date CHECK passes with the default
    // `unknown` qualifier and no bounds, and no per-type count includes
    // `census`, so the invariant is the only thing that can see it.
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.fatherNode);
      const [event] = await tx<{ id: string }[]>`
        INSERT INTO event
          (organization_id, project_id, person_id, event_type, created_by)
        VALUES (${ctx.orgId}, ${ctx.projectId}, ${personId}, 'census',
                ${ctx.createdBy})
        RETURNING id`;
      return async (undo) => {
        await undo`DELETE FROM event WHERE id = ${event!.id}`;
      };
    },
  },
  {
    check: 'event_subjects',
    // A live event whose subject came from no node: clearing the anchor is
    // legal (`legacy_node_id` is nullable and unique only where not null) and
    // no count-vs-count check can see it.
    apply: async (tx, ctx) => {
      const personId = await personOfNode(tx, ctx.orgId, ctx.wifeNode);
      await tx`UPDATE person SET legacy_node_id = NULL WHERE id = ${personId}`;
      return async (undo) => {
        await undo`UPDATE person SET legacy_node_id = ${ctx.wifeNode}
                    WHERE id = ${personId}`;
      };
    },
  },
];

describe('reconcileFactLayer divergence gate', () => {
  // Every check in RECONCILE_CHECKS has a row: if a check is ever added without
  // a divergence, this comparison fails before any SQL runs.
  it('covers every check with exactly one divergence', () => {
    expect(DIVERGENCES.map((row) => row.check).sort()).toEqual(CHECK_NAMES);
  });

  it.each(DIVERGENCES.map((row): [string, Divergence] => [row.check, row]))(
    'reports exactly %s for a legal divergence',
    async (expectedCheck, divergence) => {
      const ctx = await seedDivergenceTree();
      const sql = getTestSql();
      await backfillFactLayer(sql, ctx.orgId);

      // The baseline has to be clean, or the mutation's effect is unreadable.
      expect((await reconcileFactLayer(sql, ctx.orgId)).diffs).toEqual([]);

      const undo = await divergence.apply(sql, ctx);
      const diverged = await reconcileFactLayer(sql, ctx.orgId);
      expect(diverged.checked).toHaveLength(14);
      expect(diverged.diffs.map((diff) => diff.check)).toEqual([expectedCheck]);

      await undo(sql);
      expect((await reconcileFactLayer(sql, ctx.orgId)).diffs).toEqual([]);
    }
  );
});
