import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { persons } from './person';
import { folders, projects } from './project';
import { ltree, scopedUuid, timestamptz } from './shared';

/** Appendix A.4 (312–313): a node is a primary entry, a repeat, or an annotation. */
const nodeKinds = ['primary', 'repeat', 'annotation'] as const;

/** Renders a closed value set as a SQL literal list for a CHECK constraint. */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * One genealogy tree inside a project (appendix A.4, 280–299). Display order is
 * `seq`; `baseGeneration` is the generation number assigned to the tree root.
 */
export const lineages = pgTable(
  'lineage',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    description: text('description'),
    poemText: text('poem_text'),
    baseGeneration: integer('base_generation').notNull().default(1),
    seq: integer('seq').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('lineage_name_unique').on(t.projectId, t.name),
    foreignKey({
      columns: [t.projectId, t.folderId],
      foreignColumns: [folders.projectId, folders.id],
      name: 'lineage_folder_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'lineage_scope_fk',
    }).onDelete('restrict'),
    index('lineage_folder_idx').on(t.projectId, t.folderId),
    index('lineage_order_idx').on(t.projectId, t.seq),
    check('lineage_name_not_blank', sql`btrim(${t.name}) <> ''`),
    check('lineage_base_generation_positive', sql`${t.baseGeneration} > 0`),
    check('lineage_seq_nonnegative', sql`${t.seq} >= 0`),
  ]
);

/**
 * A position in a tree, not a person (appendix A.4, 301–337). Identity lives in
 * `person`; this row only says where that person hangs. `path` is a four-digit
 * sparse ltree label per level (`0001.0010`), and `parent_path` is a stored
 * generated column derived from it, which is what makes the self-referencing
 * parent key possible without a second writable copy of the tree position.
 */
export const nodes = pgTable(
  'node',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    lineageId: uuid('lineage_id').notNull(),
    personId: uuid('person_id'),
    path: ltree('path').notNull(),
    parentPath: ltree('parent_path').generatedAlwaysAs(
      sql.raw(
        'case when nlevel(path) > 1 then subpath(path, 0, nlevel(path) - 1) end'
      )
    ),
    kind: text('kind')
      .$type<(typeof nodeKinds)[number]>()
      .notNull()
      .default('primary'),
    displayName: text('display_name'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    // `[.]` inside a character class, so the pattern does not depend on
    // standard_conforming_strings.
    check(
      'node_path_format',
      sql`${t.path}::text ~ '^[0-9]{4}([.][0-9]{4})*$'`
    ),
    check(
      'node_annotation_person',
      sql`(${t.kind} = 'annotation') = (${t.personId} is null)`
    ),
    check('node_kind_check', sql`${t.kind} in ${valueSet(nodeKinds)}`),
    unique('node_path_unique').on(t.projectId, t.lineageId, t.path),
    foreignKey({
      columns: [t.projectId, t.lineageId],
      foreignColumns: [lineages.projectId, lineages.id],
      name: 'node_lineage_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.personId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'node_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'node_scope_fk',
    }).onDelete('restrict'),
    // Closure: the target is the three-column unique above.
    foreignKey({
      columns: [t.projectId, t.lineageId, t.parentPath],
      foreignColumns: [t.projectId, t.lineageId, t.path],
      name: 'node_parent_fk',
    }).onDelete('restrict'),
    index('node_person_idx').on(t.projectId, t.personId),
    uniqueIndex('node_one_primary')
      .on(t.projectId, t.lineageId, t.personId)
      .where(sql`${t.kind} = 'primary'`),
    index('node_path_gist').using('gist', t.projectId, t.path),
  ]
);
