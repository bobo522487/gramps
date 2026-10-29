import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { lineages, nodes, projects } from '@/lib/db/schema';
import { getTestSql, pgErrorCode, pgErrorMessages } from '../helpers/db';
import {
  addMember,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

// RLS WITH CHECK raises 42501 as well, so the SQLSTATE alone cannot tell which
// control refused the move: a policy violation says 'new row violates
// row-level security policy for table "project"', while the trigger names the
// table and the column it pinned. Both are asserted, otherwise a policy change
// could take over the job and hide a trigger that stopped working.
function immutableRejection(table: string, column: string) {
  return (error: unknown) =>
    pgErrorCode(error) === '42501' &&
    pgErrorMessages(error).some((message) =>
      message.includes(`column ${table}.${column} is immutable`)
    );
}

describe('tenant columns are immutable', () => {
  it('rejects moving a project into another organization', async () => {
    const user = await createUser();
    const from = await createOrganization();
    const to = await createOrganization();
    await addMember({
      userId: user.id,
      organizationId: from.id,
      role: 'owner',
    });
    await addMember({ userId: user.id, organizationId: to.id, role: 'owner' });
    const project = await createProject({
      orgId: from.id,
      createdBy: user.id,
    });

    await expect(
      withOrg(user.id, (tx) =>
        tx.execute(
          sql`update project set organization_id = ${to.id} where id = ${project.id}`
        )
      )
    ).rejects.toSatisfy(immutableRejection('project', 'organization_id'));
  });

  it('rejects moving a lineage into another project', async () => {
    const user = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: user.id,
      organizationId: organization.id,
      role: 'owner',
    });
    const from = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const to = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: from.id,
      createdBy: user.id,
    });

    await expect(
      withOrg(user.id, (tx) =>
        tx
          .update(lineages)
          .set({ projectId: to.id })
          .where(eq(lineages.id, lineage.id))
      )
    ).rejects.toSatisfy(immutableRejection('lineage', 'project_id'));
  });

  it('rejects moving a node into another lineage', async () => {
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
    const from = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '起始谱系',
    });
    const to = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '目标谱系',
    });
    const node = await createNode({
      orgId: organization.id,
      lineageId: from.id,
      createdBy: user.id,
      generation: 1,
    });

    await expect(
      withOrg(user.id, (tx) =>
        tx.update(nodes).set({ lineageId: to.id }).where(eq(nodes.id, node.id))
      )
    ).rejects.toSatisfy(immutableRejection('node', 'lineage_id'));
  });

  it('still allows updating ordinary columns', async () => {
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

    const [renamed] = await withOrg(user.id, (tx) =>
      tx
        .update(projects)
        .set({ name: '改名后的云谱' })
        .where(eq(projects.id, project.id))
        .returning()
    );

    expect(renamed?.name).toBe('改名后的云谱');
  });

  it('rejects a trigger argument that is not a column', async () => {
    // Every argument list is hand-written, so a typo has to fail loudly:
    // to_jsonb(NEW) -> 'typo' is NULL on both sides and the comparison would
    // silently protect nothing. A scratch table with a mis-spelled argument
    // proves the 42703 guard; the transaction is always rolled back.
    const raw = getTestSql();
    await raw`begin`;
    try {
      await raw`create table probe_tenant_typo (
        id int primary key, organization_id int
      )`;
      await raw`create trigger trg_probe_tenant_typo
        before update on probe_tenant_typo
        for each row execute function app.forbid_tenant_move('organisation_id')`;
      await raw`insert into probe_tenant_typo values (1, 1)`;

      await expect(
        raw`update probe_tenant_typo set organization_id = 2`
      ).rejects.toSatisfy(
        (error) =>
          pgErrorCode(error) === '42703' &&
          pgErrorMessages(error).some((message) =>
            message.includes(
              'tenant column organisation_id does not exist on probe_tenant_typo'
            )
          )
      );
    } finally {
      await raw`rollback`;
    }
  });

  it('guards every tenant table with the exact column list', async () => {
    // tgargs is a NUL-separated bytea holding the EXECUTE FUNCTION arguments.
    // The decode is explicit: encode(..., 'escape') renders each NUL as the
    // literal four characters \000, and array_remove drops the empty tail.
    const rows = await getTestSql()<
      {
        table_name: string;
        tgtype: number;
        tgnargs: number;
        columns: string[];
      }[]
    >`
      SELECT c.relname AS table_name,
             t.tgtype::int AS tgtype,
             t.tgnargs::int AS tgnargs,
             array_remove(
               string_to_array(encode(t.tgargs, 'escape'), '\\000'), ''
             ) AS columns
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_%_tenant_immutable'
      ORDER BY c.relname`;

    // The pinned columns per table, in the order the trigger lists them. Seven
    // of these fifteen lists had no assertion at all before: a wrong list — a
    // typo, a missing project_id, folder_id added back — used to pass as long
    // as the trigger existed.
    const expected: Record<string, string[]> = {
      activity_logs: ['organization_id'],
      article: ['organization_id', 'project_id'],
      book: ['organization_id', 'project_id'],
      book_catalog: ['organization_id', 'book_id'],
      // The family fact layer pins both halves on all three tables: a family
      // belongs to one project, and its partners and children must stay in it.
      // family_id itself stays writable (a partner can be moved to another
      // union in the same project), the composite FK keeps that honest.
      family: ['organization_id', 'project_id'],
      family_child: ['organization_id', 'project_id'],
      family_partner: ['organization_id', 'project_id'],
      folder: ['organization_id', 'project_id'],
      invite: ['organization_id'],
      lineage: ['organization_id', 'project_id'],
      node: ['organization_id', 'lineage_id'],
      organization_member: ['organization_id'],
      // person_name pins only the tenant, not person_id: Task 8's
      // reconciliation moves a name between people inside one project.
      person: ['organization_id', 'project_id'],
      person_name: ['organization_id', 'project_id'],
      project: ['organization_id'],
    };

    // Exact set first: a tenant table without a trigger, or a trigger on a
    // table that should not have one, is what this test exists to catch.
    const byTable = new Map(rows.map((row) => [row.table_name, row]));
    expect([...byTable.keys()].sort()).toEqual(Object.keys(expected).sort());

    for (const [table, columns] of Object.entries(expected)) {
      const row = byTable.get(table);
      // 19 = BEFORE (2) | ROW (1) | UPDATE (16). An AFTER, statement-level or
      // INSERT/DELETE trigger would not abort the row's update in place.
      expect(row?.tgtype, table).toBe(19);
      // tgnargs is the server's own count; checking it against the decoded
      // list means a decode that silently dropped an argument cannot pass.
      expect(row?.tgnargs, table).toBe(columns.length);
      expect(row?.columns, table).toEqual(columns);
    }
  });
});
