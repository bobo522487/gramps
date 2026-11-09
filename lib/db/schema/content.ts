import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { lineages } from './lineage';
import { folders, projects } from './project';
import { persons } from './person';
import { scopedUuid, timestamptz, uuidPk } from './shared';

export const articles = pgTable(
  'article',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    title: text('title').notNull(),
    kind: text('kind').notNull().default('other').$type<ArticleKind>(),
    // `body` 是分页文档包（ArticleContent）的**文本化序列化**：取代旧的
    // `content` jsonb + `plain_text`。`plain_text` 不再落库，读取时由
    // `pagePlainText` / `derivePlainText` 现算（ADR 0010）。NOT NULL + 非空
    // 检查保证空谱文也是一段合法 JSON，而不是空串（data-model.md §8 #5）。
    body: text('body').notNull(),
    authorText: text('author_text'),
    dateText: text('date_text'),
    subjectPersonId: uuid('subject_person_id'),
    lineageId: uuid('lineage_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Target state (appendix A.5): composite key, no soft delete, no updated_at.
    primaryKey({ columns: [t.projectId, t.id] }),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      // 约束名必须与基线 DDL 逐字一致：deleteProject 按约束名精确判定 not_empty，
      // 名字对不上时那个分支永不命中，删项目会直接 500。
      name: 'article_scope_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.folderId],
      foreignColumns: [folders.projectId, folders.id],
      name: 'article_folder_fk',
    }).onDelete('set null'),
    foreignKey({
      columns: [t.projectId, t.subjectPersonId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'article_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.lineageId],
      foreignColumns: [lineages.projectId, lineages.id],
      name: 'article_lineage_fk',
    }).onDelete('restrict'),
    index('article_folder_idx').on(t.projectId, t.folderId),
    index('article_person_idx').on(t.projectId, t.subjectPersonId),
    index('article_lineage_idx').on(t.projectId, t.lineageId),
    check(
      'ck_article_kind',
      sql`${t.kind} in ('preface','biography','epitaph','rules','research','verse','other')`
    ),
    check('ck_article_body', sql`btrim(${t.body}) <> ''`),
  ]
);

/** `article.kind` 的合法值域（附录 A.5 `ck_article_kind`）。 */
export type ArticleKind =
  | 'preface'
  | 'biography'
  | 'epitaph'
  | 'rules'
  | 'research'
  | 'verse'
  | 'other';

export const books = pgTable(
  'book',
  {
    id: scopedUuid(),
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
  },
  (t) => [
    // Target state (appendix A.5). The composite key is also what finally makes
    // `book_export_book_fk` executable — that FK targets `book (project_id, id)`.
    primaryKey({ columns: [t.projectId, t.id] }),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'book_scope_fk',
    }).onDelete('restrict'),
    unique('uk_book_organization_id').on(t.orgId, t.id),
    unique('uk_book_name').on(t.orgId, t.projectId, t.name),
  ]
);

export const bookCatalogs = pgTable(
  'book_catalog',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    // Composite FK below: a catalog row must hang off a book in the same org.
    // The old single-column REFERENCES book(id) ON DELETE CASCADE is gone —
    // app_rw has no DELETE grant, so cascade never fired, and it allowed the
    // catalog's organization_id to disagree with the book's.
    bookId: uuid('book_id').notNull(),
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
    foreignKey({
      columns: [t.orgId, t.bookId],
      foreignColumns: [books.orgId, books.id],
      name: 'fk_catalog_book',
    }).onDelete('restrict'),
    // Same book AND same organization.
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
