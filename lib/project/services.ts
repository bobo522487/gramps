import 'server-only';

import { and, eq, isNull } from 'drizzle-orm';
import { withOrg } from '@/lib/db/drizzle';
import { requireOrgPermission } from '@/lib/db/guards';
import { logActivityInTx } from '@/lib/db/queries/activity';
import {
  ActivityType,
  organizations,
  type Project,
  projects,
} from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import type { ProjectStatus } from './constants';

export type ProjectCreateInput = {
  name: string;
  surname: string;
  themeName: string;
  countriesRegions: string;
  status: ProjectStatus;
  importance: number;
  notes?: string | null;
};

export type ProjectMutableInput = {
  name: string;
  countriesRegions: string | null;
  hallCode?: string | null;
  status: ProjectStatus;
  importance: number;
  notes?: string | null;
};

export type ProjectUpdates = Partial<ProjectMutableInput>;

export type ProjectMutationResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'conflict' };

export async function createProjectInTransaction(params: {
  userId: string;
  orgId: string;
  input: ProjectCreateInput;
  ipAddress?: string;
}): Promise<ProjectMutationResult> {
  const { userId, orgId, input, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    if (!(await requireOrgPermission(tx, userId, orgId, 'project.write'))) {
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
          name: input.name,
          surname: input.surname,
          themeName: input.themeName,
          countriesRegions: input.countriesRegions,
          status: input.status,
          importance: input.importance,
          notes: input.notes,
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
    if (!(await requireOrgPermission(tx, userId, orgId, 'project.write'))) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const mutable: ProjectUpdates = {};
    if (updates.name !== undefined) mutable.name = updates.name;
    if (updates.countriesRegions !== undefined) {
      mutable.countriesRegions = updates.countriesRegions;
    }
    if (updates.hallCode !== undefined) mutable.hallCode = updates.hallCode;
    if (updates.status !== undefined) mutable.status = updates.status;
    if (updates.importance !== undefined) {
      mutable.importance = updates.importance;
    }
    if (updates.notes !== undefined) mutable.notes = updates.notes;

    const [project] = await tx
      .update(projects)
      .set({ ...mutable, updatedAt: new Date() })
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
    if (!(await requireOrgPermission(tx, userId, orgId, 'project.write'))) {
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
