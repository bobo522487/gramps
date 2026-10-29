import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { lineages, nodes, projects } from '@/lib/db/schema';
import { getTestSql, pgErrorCode } from '../helpers/db';
import {
  addMember,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

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
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');
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
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');
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
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');
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

  it('guards every tenant table that has a tenant column', async () => {
    const rows = await getTestSql()<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_%_tenant_immutable'
      ORDER BY c.relname`;
    expect(rows.map((r) => r.table_name)).toEqual([
      'activity_logs',
      'article',
      'book',
      'book_catalog',
      'folder',
      'invite',
      'lineage',
      'node',
      'organization_member',
      'project',
    ]);
  });
});
