import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './project';
import { ltree, timestamptz, uuidPk } from './shared';

export const lineages = pgTable(
  'lineage',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    surname: text('surname').notNull(),
    hallCode: text('hall_code'),
    generationWords: jsonb('generation_words').$type<string[]>(),
    region: text('region'),
    notes: text('notes'),
    nodeCount: integer('node_count').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_lineage_project',
    }).onDelete('restrict'),
    unique('uk_lineage_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_lineage_name')
      .on(t.orgId, t.projectId, t.name)
      .where(sql`${t.deletedAt} is null`),
    index('idx_lineage_project')
      .on(t.orgId, t.projectId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const nodes = pgTable(
  'node',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    lineageId: uuid('lineage_id').notNull(),
    parentId: uuid('parent_id'),
    spouseOfId: uuid('spouse_of_id'),
    role: text('role').notNull().default('blood'),
    path: ltree('path'),
    depth: integer('depth').notNull().default(0),
    generation: integer('generation').notNull(),
    /**
     * Derived from path, so a writer cannot disagree with the tree it lives in.
     * Spouses have no path and sit at level 0. Read-only: the database rejects
     * any INSERT/UPDATE that names this column.
     */
    level: integer('level').generatedAlwaysAs(
      sql`case when ${sql.identifier('path')} is null then 0 else nlevel(${sql.identifier('path')}) - 1 end`
    ),
    sort: integer('sort').notNull().default(0),
    name: text('name').notNull(),
    surname: text('surname').notNull(),
    fullName: text('full_name').notNull(),
    sex: smallint('sex').notNull(),
    courtesy: text('courtesy'),
    namePrefix: text('name_prefix'),
    isAlive: boolean('is_alive').notNull().default(true),
    birthText: text('birth_text'),
    deathText: text('death_text'),
    birthYear: integer('birth_year'),
    deathYear: integer('death_year'),
    burialPlace: text('burial_place'),
    biography: text('biography'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.lineageId],
      foreignColumns: [lineages.orgId, lineages.id],
      name: 'fk_node_lineage',
    }).onDelete('restrict'),
    unique('uk_node_organization_id').on(t.orgId, t.id),
    // A parent must live in the same organization AND the same lineage; without
    // this the database happily lets you hang a person under another tree.
    unique('uk_node_org_lineage_id').on(t.orgId, t.lineageId, t.id),
    foreignKey({
      columns: [t.parentId, t.orgId, t.lineageId],
      foreignColumns: [t.id, t.orgId, t.lineageId],
      name: 'fk_node_parent_same_lineage',
    }).onDelete('restrict'),
    // A spouse must be attached inside the same tree; the composite unique key
    // uk_node_org_lineage_id above is what makes this edge constrainable.
    foreignKey({
      columns: [t.spouseOfId, t.orgId, t.lineageId],
      foreignColumns: [t.id, t.orgId, t.lineageId],
      name: 'fk_node_spouse_same_lineage',
    }).onDelete('restrict'),
    check('ck_node_role', sql`${t.role} in ('blood', 'spouse')`),
    check('ck_node_sex', sql`${t.sex} in (0, 1)`),
    check(
      'ck_node_spouse_has_no_path',
      sql`(${t.role} = 'spouse' and ${t.path} is null and ${t.spouseOfId} is not null) or (${t.role} = 'blood' and ${t.path} is not null)`
    ),
    /**
     * A CHECK cannot reference a generated column, so this repeats the level
     * expression rather than comparing against "level" (which PostgreSQL
     * rejects at ALTER TABLE time).
     */
    check(
      'ck_node_generation_lte_level',
      sql`${t.generation} >= case when ${t.path} is null then 1 else nlevel(${t.path}) end`
    ),
    // Depth must agree with the same ltree path that level is derived from.
    // CHECK cannot reference the generated `level` column, so the expression
    // is repeated; spouses (path IS NULL) keep their app-managed depth.
    check(
      'ck_node_depth_eq_level',
      sql`${t.path} is null or ${t.depth} = nlevel(${t.path}) - 1`
    ),
    index('idx_node_lineage_depth').on(t.orgId, t.lineageId, t.depth),
    index('idx_node_parent').on(t.orgId, t.parentId),
    index('idx_node_alive')
      .on(t.orgId, t.lineageId)
      .where(sql`${t.deletedAt} is null`),
  ]
);
