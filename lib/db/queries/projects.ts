import 'server-only';

import { and, count, desc, eq, sql } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import type { Project } from '../schema';
import { organizations, orgMembers, projects } from '../schema';

export async function getProjects(
  userId: string,
  orgId: string
): Promise<Project[]> {
  return withOrg(userId, (tx) =>
    tx
      .select()
      .from(projects)
      .where(eq(projects.orgId, orgId))
      .orderBy(desc(projects.createdAt))
  );
}

export async function countProjects(
  userId: string,
  orgId: string
): Promise<number> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.orgId, orgId));
    return rows[0]?.value ?? 0;
  });
}

/** Scoped by orgId so a project from another org is never returned. */
export async function getProjectById(
  userId: string,
  projectId: string,
  orgId: string
): Promise<Project | null> {
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .limit(1);
    return rows[0] ?? null;
  });
}

/**
 * Resolves project, org and role together, scoped to the signed-in user.
 *
 * 必须带 `status <> 'closed'`：目标态没有软删，组织关停后行还在表里，
 * 漏掉这个条件就能用 `/project/[ref]` 直达已关停组织的项目，绕过关停闸门。
 * 判断口径与 `lib/db/queries/organizations.ts` 的 `notClosed` 一致。
 */
export async function getProjectScopeByRef(userId: string, ref: string) {
  const orgOpen = sql`${organizations.status} <> 'closed'`;
  return withOrg(userId, async (tx) => {
    const rows = await tx
      .select({
        project: projects,
        organization: organizations,
        role: orgMembers.role,
      })
      .from(projects)
      .innerJoin(organizations, eq(projects.orgId, organizations.id))
      .innerJoin(
        orgMembers,
        and(
          eq(orgMembers.organizationId, organizations.id),
          eq(orgMembers.userId, userId)
        )
      )
      .where(and(eq(projects.ref, ref), orgOpen))
      .limit(1);

    return rows[0] ?? null;
  });
}
