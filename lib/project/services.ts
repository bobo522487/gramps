import 'server-only';

import { and, eq, sql } from 'drizzle-orm';
import { queryRows } from '@/lib/db/drizzle';
import { sqlStateOf } from '@/lib/db/errors';
import { organizations, type Project, projects } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
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
  const { userId, orgId, input } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
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
  const { userId, orgId, projectId, updates } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
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
      .set({ ...mutable })
      .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
      .returning();

    if (!project) {
      return { ok: false, reason: 'not_found' as const };
    }

    return { ok: true as const, project };
  });
}

/**
 * 删除项目：让数据库的外键约束自己判定「项目里还有内容」。
 *
 * `project` 的每一张子表外键都是 `ON DELETE RESTRICT`，有子行时 `DELETE`
 * 会以 `23001` 失败（插入类 FK 违约是 `23503`）。用一个 SAVEPOINT 把这条
 * 可能失败的语句隔离出来：命中 RESTRICT 就回滚到 SAVEPOINT，事务恢复到
 * 可提交状态并返回 `not_empty`。既不预先探查 13 张子表，也不维护约束名清单——
 * 约束交给数据库，清单交给 `pg_constraint`。
 */
export async function deleteProjectInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  ipAddress?: string;
}): Promise<
  { ok: true } | { ok: false; reason: 'forbidden' | 'not_found' | 'not_empty' }
> {
  const { userId, orgId, projectId } = params;

  return withOrgWrite(userId, orgId, 'project.write', async (tx) => {
    await tx.execute(sql`savepoint delete_project`);
    try {
      const rows = await queryRows<{ id: string }>(
        tx,
        sql`delete from project where organization_id = ${orgId} and id = ${projectId} returning id`
      );
      if (rows.length === 0) {
        await tx.execute(sql`release savepoint delete_project`);
        return { ok: false, reason: 'not_found' as const };
      }
      await tx.execute(sql`release savepoint delete_project`);
      return { ok: true as const };
    } catch (error) {
      // RESTRICT 违约后事务进入 aborted 状态；必须先回到 SAVEPOINT 才能继续
      // 提交。分类只看 SQLSTATE，不猜约束名；其余错误保留原链交给包装器兜底。
      await tx.execute(sql`rollback to savepoint delete_project`);
      if (sqlStateOf(error, '23001') || sqlStateOf(error, '23503')) {
        return { ok: false, reason: 'not_empty' as const };
      }
      throw error;
    }
  });
}
