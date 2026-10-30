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
  'families',
  'partners',
  'persons',
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
});
