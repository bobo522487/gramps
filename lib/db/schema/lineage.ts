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
    /**
     * The whole tree position. Depth is `nlevel(path) - 1` and is not stored:
     * a stored copy would be a second answer to the same question, and the only
     * reader that ever wanted depth (ordering inside one generation) already has
     * `generation`, which is constant across a generation.
     */
    path: ltree('path'),
    /**
     * 世次. Deliberately not derived from path: `ck_node_generation_gte_tree_depth`
     * allows a generation deeper than the tree position (a person recorded a
     * generation below where they hang), so this one is stored.
     */
    generation: integer('generation').notNull(),
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
    /**
     * 创建幂等键（R31）：客户端每「一次提交意图」生成一个 uuid，只有创建路径写它。
     * 同组织内唯一（见 uk_node_org_request_id），重放与并发双飞都落回已有那一行。
     * 共创配偶不写这个键——它会与血亲撞同一索引，重放时按 spouse_of_id 找回。
     * 迁移前的历史行为 NULL，部分唯一索引不约束 NULL。
     */
    requestId: uuid('request_id'),
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
    // 世次 may exceed tree depth on purpose (see the `generation` comment), but
    // it may never be shallower than the position the path proves.
    check(
      'ck_node_generation_gte_tree_depth',
      sql`${t.generation} >= case when ${t.path} is null then 1 else nlevel(${t.path}) end`
    ),
    index('idx_node_parent').on(t.orgId, t.parentId),
    // 创建幂等（R31）：同一组织内一个 requestId 只能留下一行未删人丁。
    // 软删行不在索引里，所以删掉之后同一键可以再次录入。
    uniqueIndex('uk_node_org_request_id')
      .on(t.orgId, t.requestId)
      .where(sql`${t.requestId} is not null and ${t.deletedAt} is null`),
    index('idx_node_alive')
      .on(t.orgId, t.lineageId)
      .where(sql`${t.deletedAt} is null`),
  ]
);
