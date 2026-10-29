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
import { lineages } from './lineage';
import { projects } from './project';
import { timestamptz, uuidPk } from './shared';

export const articles = pgTable(
  'article',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    title: text('title').notNull(),
    kind: text('kind'),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    plainText: text('plain_text'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_article_project',
    }).onDelete('restrict'),
    unique('uk_article_organization_id').on(t.orgId, t.id),
    index('idx_article_project')
      .on(t.orgId, t.projectId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const books = pgTable(
  'book',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    title: text('title').notNull(),
    surname: text('surname').notNull(),
    hallCode: text('hall_code'),
    volumeNo: text('volume_no'),
    author: text('author'),
    compiledAt: text('compiled_at'),
    coverSpec: jsonb('cover_spec')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    backCoverSpec: jsonb('back_cover_spec').$type<Record<string, unknown>>(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_book_project',
    }).onDelete('restrict'),
    unique('uk_book_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_book_name')
      .on(t.orgId, t.projectId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const bookCatalogs = pgTable(
  'book_catalog',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    section: smallint('section').notNull(),
    articleId: uuid('article_id'),
    lineageId: uuid('lineage_id'),
    sort: integer('sort').notNull().default(0),
    hide: boolean('hide').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.articleId],
      foreignColumns: [articles.orgId, articles.id],
      name: 'fk_catalog_article',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.lineageId],
      foreignColumns: [lineages.orgId, lineages.id],
      name: 'fk_catalog_lineage',
    }).onDelete('restrict'),
    unique('uk_book_catalog_org_book_id').on(t.orgId, t.bookId, t.id),
    // Same book AND same organization. ON DELETE cascade was dead weight:
    // app_rw has no DELETE grant, so the cascade could never fire.
    foreignKey({
      columns: [t.parentId, t.orgId, t.bookId],
      foreignColumns: [t.id, t.orgId, t.bookId],
      name: 'fk_catalog_parent_same_book',
    }).onDelete('restrict'),
    check('ck_catalog_section', sql`${t.section} in (1, 2, 3)`),
    check(
      'ck_catalog_one_target',
      sql`num_nonnulls(${t.articleId}, ${t.lineageId}) <= 1`
    ),
    index('idx_catalog_book')
      .on(t.orgId, t.bookId, t.sort)
      .where(sql`${t.deletedAt} is null`),
    index('idx_catalog_article')
      .on(t.orgId, t.articleId)
      .where(sql`${t.articleId} is not null`),
    index('idx_catalog_lineage')
      .on(t.orgId, t.lineageId)
      .where(sql`${t.lineageId} is not null`),
  ]
);
