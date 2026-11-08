import 'server-only';

import { and, eq } from 'drizzle-orm';
import {
  foreignKeyConstraintOf,
  isForeignKeyViolationOf,
} from '@/lib/db/errors';
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
 * 基线 DDL 里所有挂在 `project` 上的子表外键，按表名排序，与
 * `lib/db/migrations/0000_target_schema.sql` 一一对应（当前 13 条）。
 * 新增任何引用 `project(organization_id, id)` 的表，都必须在这里登记，
 * 否则删除会走「未登记约束」的报错分支而不是友好提示——这是刻意的：
 * 静默吞掉未知 FK 故障比报错更难查。
 * 该清单由 `tests/s8-stage-b2a.test.ts` 的 B2a-11 与基线 DDL 交叉校验。
 */
const PROJECT_CHILD_CONSTRAINTS = [
  'article_scope_fk',
  'book_catalog_scope_fk',
  'book_export_scope_fk',
  'book_scope_fk',
  'event_scope_fk',
  'family_child_scope_fk',
  'family_partner_scope_fk',
  'family_scope_fk',
  'folder_scope_fk',
  'lineage_scope_fk',
  'node_scope_fk',
  'person_name_scope_fk',
  'person_scope_fk',
] as const;

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
    // Target state has no soft delete: this is a real DELETE. Every
    // project-internal FK is RESTRICT, so a project that still has folders,
    // lineages, articles or books fails with 23503 — that is the intended
    // "RESTRICT protects data" behaviour, surfaced as `not_empty` so the UI can
    // ask the user to clear the project first.
    try {
      const rows = await tx
        .delete(projects)
        .where(and(eq(projects.id, projectId), eq(projects.orgId, orgId)))
        .returning({ id: projects.id });

      if (rows.length === 0) {
        return { ok: false, reason: 'not_found' as const };
      }
    } catch (error) {
      // 只把「项目内还有内容」这一种 23503 翻译成 `not_empty`。宽匹配会把别处
      // 的 FK 故障伪装成业务提示——用户照着提示清空内容后依然删不掉，错误被吞。
      // 约束名清单来自基线 DDL：每张挂在 project 上的表都只有一条
      // `*_scope_fk FOREIGN KEY (organization_id, project_id)`，共 13 条。
      if (isForeignKeyViolationOf(error, PROJECT_CHILD_CONSTRAINTS)) {
        return { ok: false, reason: 'not_empty' as const };
      }
      const constraint = foreignKeyConstraintOf(error);
      if (constraint) {
        // 未登记的新约束：宁可报错也不猜。补进上面清单即可恢复友好提示。
        throw new Error(
          `deleteProject 命中未登记的 project 子表约束 ${constraint}`,
          { cause: error }
        );
      }
      throw error;
    }

    return { ok: true as const };
  });
}
