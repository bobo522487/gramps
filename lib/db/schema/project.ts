import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ProjectStatus } from '../../project/constants';
import { organizations } from './org';
import { timestamptz, uuidPk } from './shared';

export const projects = pgTable(
  'project',
  {
    id: uuidPk(),
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
    notes: text('notes'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    unique('uk_project_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_project_ref').on(t.ref).where(sql`${t.deletedAt} is null`),
    index('idx_project_organization')
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
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
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: smallint('kind').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_folder_project',
    }).onDelete('restrict'),
    // Target of the self-referencing parent key below: a parent must live in
    // the same organization AND the same project.
    unique('uk_folder_org_project_id').on(t.orgId, t.projectId, t.id),
    foreignKey({
      columns: [t.parentId, t.orgId, t.projectId],
      foreignColumns: [t.id, t.orgId, t.projectId],
      name: 'fk_folder_parent_same_project',
    }).onDelete('restrict'),
    index('idx_folder_project')
      .on(t.orgId, t.projectId, t.kind)
      .where(sql`${t.deletedAt} is null`),
    check('ck_folder_kind', sql`${t.kind} in (0, 1, 2)`),
  ]
);
