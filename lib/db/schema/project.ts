import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ProjectStatus } from '../../project/constants';
import { users } from './auth';
import { organizations } from './org';
import { scopedUuid, timestamptz } from './shared';

export const projects = pgTable(
  'project',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** 20-char public id used as the second URL segment. */
    ref: text('ref').notNull().default(sql`public.generate_public_id()`),
    name: text('name').notNull(),
    /** Immutable after creation. */
    themeName: text('theme_name'),
    surname: text('surname'),
    countriesRegions: text('countries_regions'),
    hallCode: text('hall_code'),
    status: text('status')
      .$type<ProjectStatus>()
      .notNull()
      .default('in_progress'),
    importance: smallint('importance').notNull().default(1),
    /**
     * Per-project escape hatch for 族内婚 (堂兄妹婚): when true,
     * `app.check_family_blood_side()` stops enforcing "at most one blood
     * partner per family". Default false because the invariant is the point.
     */
    allowConsanguineousMarriage: boolean('allow_consanguineous_marriage')
      .notNull()
      .default(false),
    notes: text('notes'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // 附录 A.2：`text REFERENCES auth.user(id) ON DELETE SET NULL`——可空，
    // 因为销号不该连带卡死项目。原来写 uuid + not null，与 auth.user(id) 的
    // text 类型不一致（建表 42804），且销号会撞 not-null。
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    // Target state (appendix A.2): PRIMARY KEY (organization_id, id) plus a
    // global UNIQUE (id). `ref` is a documented target-state extension column
    // (docs/data-model.md §4); with soft delete gone its uniqueness is total.
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('project_id_global').on(t.id),
    uniqueIndex('uk_project_ref').on(t.ref),
    index('idx_project_organization').on(t.orgId),
    check(
      'ck_project_status',
      sql`${t.status} in ('planning', 'in_progress', 'completed')`
    ),
    check('ck_project_importance', sql`${t.importance} between 1 and 5`),
  ]
);

export const folders = pgTable(
  'folder',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: smallint('kind').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
  },
  (t) => [
    // Target state (appendix A.2): PRIMARY KEY (project_id, id). This also
    // removes the 42830 hazard logged in A′: `lineage_folder_fk` references
    // folder (project_id, id), which a single-column `id` key could not serve.
    primaryKey({ columns: [t.projectId, t.id] }),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'folder_scope_fk',
    }).onDelete('restrict'),
    // Target of the self-referencing parent key below: a parent must live in
    // the same organization AND the same project. Kept until phase B2 retires
    // the legacy folder columns and rewrites this key.
    unique('uk_folder_org_project_id').on(t.orgId, t.projectId, t.id),
    foreignKey({
      columns: [t.parentId, t.orgId, t.projectId],
      foreignColumns: [t.id, t.orgId, t.projectId],
      name: 'fk_folder_parent_same_project',
    }).onDelete('restrict'),
    index('idx_folder_project').on(t.orgId, t.projectId, t.kind),
    check('ck_folder_kind', sql`${t.kind} in (0, 1, 2)`),
  ]
);
