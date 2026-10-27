import { describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';
import {
  createLineage,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

// The write-path index behind Task 1's mirror image. Task 1 deleted an index
// with no consumer; this is a consumer with no index.
//
// nextSpouseSort (lib/lineage/node-services.ts:137-156) computes the next
// spouse `sort` by filtering node on
//   organization_id, lineage_id, role = 'spouse', spouse_of_id, deleted_at IS NULL
// and it runs from both live spouse write paths (:217 co-recorded spouse,
// :495 add spouse) inside the FOR UPDATE lineage lock taken by
// loadLineageForUpdate. node had no index leading on spouse_of_id, so every
// one of those writes scanned the whole lineage while holding the lock.
//
// The index lives in migration 0014 only, not lib/db/schema.ts: schema.ts sits
// exactly at its F6 exemption ceiling of 688 lines (scripts/check-file-size.mjs),
// so adding an index() declaration there turns pnpm arch:check red. Same
// precedent as idx_node_lineage_path — hand-written in a migration, absent
// from the Drizzle snapshot, drift check clean.

// The query is EXPLAINed with these literal values rather than bound
// parameters: the planner only folds constants to their real selectivities, and
// a subquery against a near-empty table would fold to NULL and produce a
// one-row Result node that measures nothing.
const ORG = '00000000-0000-7000-8000-000000000001';
const LINEAGE = '00000000-0000-7000-8000-000000000002';
const SPOUSE_OF = '00000000-0000-7000-8000-000000000003';

function spouseSortQuery(sql: ReturnType<typeof getTestSql>) {
  // nextSpouseSort's predicate verbatim, lineage_id included: the real query
  // filters on it, so the plan must be measured with it.
  return sql`
    select coalesce(max(sort), -1)::int from node
    where organization_id = ${ORG}::uuid
      and lineage_id = ${LINEAGE}::uuid
      and role = 'spouse'
      and spouse_of_id = ${SPOUSE_OF}::uuid
      and deleted_at is null
  `;
}

describe('spouse sort index', () => {
  it('declares idx_node_spouse_sort as a partial (organization_id, spouse_of_id) index', async () => {
    const rows = await getTestSql()<
      { indexdef: string }[]
    >`select indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'node'
        and indexname = 'idx_node_spouse_sort'`;

    expect(rows).toHaveLength(1);
    const def = String(rows[0]?.indexdef);
    // Column order is load-bearing: organization_id first (the RLS/filter
    // prefix every node query carries), then the spouse_of_id equality.
    expect(def).toMatch(/\(organization_id, spouse_of_id\)/);
    // Partial, matching the query predicate and the idx_node_alive precedent.
    expect(def).toMatch(/WHERE \(deleted_at IS NULL\)/);
  });

  it('is usable by the nextSpouseSort query shape', async () => {
    const sql = getTestSql();

    // Measured against a population of spouses, because on an empty or tiny
    // table the planner can reach any index covering the org/lineage prefix at
    // the same startup cost (a fresh partial btree and the ltree GiST index
    // compare identically before the first VACUUM) and then breaks the tie on
    // micro-benchmarked I/O — the answer then flips on nothing. 200 spouses
    // under one spouse_of_id is the shape this index exists for.
    //
    // Everything is written inside a transaction that is always rolled back, so
    // the test leaves no rows behind (integration setup.ts truncates between
    // files, not within one).
    await sql`begin`;
    try {
      const user = await createUser();
      const personal = await getPersonalOrg(user.id);
      if (!personal) {
        throw new Error('registration trigger did not create an org');
      }
      const orgId = personal.organization.id;
      const project = await createProject({ orgId, createdBy: user.id });
      const lineage = await createLineage({
        orgId,
        projectId: project.id,
        createdBy: user.id,
      });

      // id is a column default (uuidv7()), so the anchor can be placed at the
      // exact literals the plan is measured with.
      await sql`
        insert into node (id, organization_id, lineage_id, path, depth,
                          generation, sort, name, surname, full_name, sex,
                          created_by)
        values (${SPOUSE_OF}::uuid, ${orgId}::uuid, ${lineage.id}::uuid,
                ${`${orgId}.${lineage.id}`}::ltree, 1, 2, 0,
                'anchor', '陈', '陈anchor', 0, ${user.id}::uuid)
      `;
      // Spouses carry no path (ck_node_spouse_has_no_path) and their depth is
      // app-managed, so they bypass createNode, which derives depth from path.
      await sql`
        insert into node (organization_id, lineage_id, role, spouse_of_id,
                          depth, generation, sort, name, surname, full_name,
                          sex, created_by)
        select ${orgId}::uuid, ${lineage.id}::uuid, 'spouse',
               ${SPOUSE_OF}::uuid, 1, 1, g, 'spouse ' || g, '陈',
               '陈spouse ' || g, 1, ${user.id}::uuid
        from generate_series(0, 199) as g
      `;
      // Statistics are what make the planner compare selectivities rather than
      // guess 1 row for every index.
      await sql`analyze node`;

      // Force the decision away from "table is small, just scan it", so the
      // plan reflects the index that matches the predicate.
      await sql`set local enable_seqscan = off`;
      const rows = await sql<{ 'QUERY PLAN': unknown }[]>`
        explain (format json) ${spouseSortQuery(sql)}
      `;
      const plan = JSON.stringify(rows);

      const chosen = [...plan.matchAll(/"Index Name":"([^"]+)"/g)].map(
        (match) => match[1]
      );
      expect(chosen, plan).toContain('idx_node_spouse_sort');
      // The point of the index: spouse_of_id is applied as an index condition,
      // not left as a filter over the whole lineage.
      expect(plan).toContain(
        `"Index Cond":"((organization_id = '${ORG}'::uuid) AND (spouse_of_id = '${SPOUSE_OF}'::uuid))"`
      );
    } finally {
      await sql`rollback`;
    }
  });
});
