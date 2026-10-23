import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { getOrgRoleInTx, hasPermission } from '@/lib/auth/permissions';
import { generatePublicId } from '@/lib/ids';
import { withOrg } from './drizzle';
import { logActivityInTx } from './queries/activity';
import { ActivityType, organizations, type Project, projects } from './schema';

export type ProjectInput = {
  name: string;
  primaryName: string;
  primarySurname: string;
  hallCode?: string | null;
  countriesRegions?: string | null;
};

export type ProjectUpdates = Partial<ProjectInput>;

export type ProjectMutationResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'conflict' };

export async function createProjectInTransaction(params: {
  userId: string;
  orgId: string;
  input: ProjectInput;
  ipAddress?: string;
}): Promise<ProjectMutationResult> {
  const { userId, orgId, input, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);
    if (!organization) {
      return { ok: false, reason: 'not_found' as const };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // A fresh ref on every attempt: reusing a colliding one would loop.
      const [project] = await tx
        .insert(projects)
        .values({
          ...input,
          orgId,
          ref: generatePublicId(),
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();

      if (project) {
        await logActivityInTx(
          tx,
          userId,
          orgId,
          ActivityType.CREATE_PROJECT,
          ipAddress
        );
        return { ok: true as const, project };
      }
    }

    return { ok: false, reason: 'conflict' as const };
  });
}

export async function updateProjectInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  updates: ProjectUpdates;
  ipAddress?: string;
}): Promise<ProjectMutationResult> {
  const { userId, orgId, projectId, updates, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [project] = await tx
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt)
        )
      )
      .returning();

    if (!project) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.UPDATE_PROJECT,
      ipAddress
    );
    return { ok: true as const, project };
  });
}

export async function deleteProjectInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  ipAddress?: string;
}): Promise<{ ok: true } | { ok: false; reason: 'forbidden' | 'not_found' }> {
  const { userId, orgId, projectId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const rows = await tx
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt)
        )
      )
      .returning({ id: projects.id });

    if (rows.length === 0) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.DELETE_PROJECT,
      ipAddress
    );
    return { ok: true as const };
  });
}
