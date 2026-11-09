import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { lineages } from './lineage';
import { persons } from './person';
import { folders, projects } from './project';
import { scopedUuid, timestamptz } from './shared';

/**
 * Postgres `ltree`（基线 95 行的 btree_gist 扩展在 DDL 基线里开）。
 * Drizzle 没有内建类型，用 customType 桥接；驱动侧按字符串收发。
 */
const ltree = customType<{ data: string; driverData: string }>({
  dataType: () => 'ltree',
});

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
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    // Composite FK below: a catalog row must hang off a book in the same
    // project — single-column REFERENCES book(id) would let the catalog's
    // project disagree with the book's.
    bookId: uuid('book_id').notNull(),
    // 层级路径（T25）：`0001.0002` 形态，见 book_catalog_path_format。
    // 父路径由库生成（nlevel=1 时为 NULL，自引用 FK 随之不生效——顶层无父）。
    path: ltree('path').notNull(),
    parentPath: ltree('parent_path').generatedAlwaysAs(
      sql`case when nlevel(path) > 1 then subpath(path, 0, nlevel(path) - 1) end`
    ),
    title: text('title').notNull(),
    articleId: uuid('article_id'),
    lineageId: uuid('lineage_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    check(
      'book_catalog_path_format',
      sql`${t.path}::text ~ '^[0-9]{4}([.][0-9]{4})*$'`
    ),
    unique('book_catalog_path_unique').on(t.projectId, t.bookId, t.path),
    check(
      'book_catalog_one_content',
      sql`num_nonnulls(${t.articleId}, ${t.lineageId}) <= 1`
    ),
    unique('book_catalog_article_once').on(t.projectId, t.bookId, t.articleId),
    unique('book_catalog_lineage_once').on(t.projectId, t.bookId, t.lineageId),
    foreignKey({
      columns: [t.projectId, t.bookId],
      foreignColumns: [books.projectId, books.id],
      name: 'book_catalog_book_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.articleId],
      foreignColumns: [articles.projectId, articles.id],
      name: 'book_catalog_article_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.lineageId],
      foreignColumns: [lineages.projectId, lineages.id],
      name: 'book_catalog_lineage_fk',
    }).onDelete('restrict'),
    // Same project AND same organization.
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'book_catalog_scope_fk',
    }).onDelete('restrict'),
    // 父路径 FK（自引用）：path 为生成列，nlevel=1 时为 NULL，复合 FK 有 NULL
    // 即不校验，所以顶层编目无需父行。已通过 t 引用本表，无循环导入问题。
    foreignKey({
      columns: [t.projectId, t.bookId, t.parentPath],
      foreignColumns: [t.projectId, t.bookId, t.path],
      name: 'book_catalog_parent_fk',
    }).onDelete('restrict'),
    // (uuid, ltree) 上的 GiST 需要 btree_gist（基线 95 行已开）。
    index('book_catalog_path_gist').using('gist', t.projectId, t.path),
    index('book_catalog_article_idx')
      .on(t.projectId, t.articleId)
      .where(sql`${t.articleId} is not null`),
    index('book_catalog_lineage_idx')
      .on(t.projectId, t.lineageId)
      .where(sql`${t.lineageId} is not null`),
  ]
);
