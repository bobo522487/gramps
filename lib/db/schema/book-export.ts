import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { books } from './content';
import { projects } from './project';
import { enumValues, scopedUuid, timestamptz } from './shared';

/** Appendix A.5 (432–433): closed value set for the export format. */
const exportFormats = ['pdf', 'typst', 'epub', 'html', 'other'] as const;

/**
 * Metadata for an export artifact, not a content snapshot (appendix A.5,
 * 422–443). A book owns positions, never a frozen copy of the content; the
 * historical original only lives in an out-of-database artifact, and this
 * table records its URI, checksum and the fact cutoff it was built from.
 *
 * The `(project_id, id)` composite key keeps exports inside the same scope as
 * the book they belong to. `book_export_book_fk` points at the target-state
 * `book (project_id, id)` key; `content.ts` now matches it as of batch B2a, so
 * the foreign key resolves without a 42830.
 */
export const bookExports = pgTable(
  'book_export',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    bookId: uuid('book_id').notNull(),
    exportedAt: timestamptz('exported_at').notNull().defaultNow(),
    factCutoff: timestamptz('fact_cutoff').notNull(),
    artifactUri: text('artifact_uri').notNull(),
    checksum: text('checksum').notNull(),
    format: text('format')
      .$type<(typeof exportFormats)[number]>()
      .notNull()
      .default('pdf'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('book_export_id_global').on(t.id),
    check('book_export_cutoff', sql`${t.factCutoff} <= ${t.exportedAt}`),
    check(
      'book_export_artifact_uri_not_blank',
      sql`btrim(${t.artifactUri}) <> ''`
    ),
    check('book_export_checksum', sql`${t.checksum} ~ '^[0-9a-f]{64}$'`),
    check(
      'book_export_format',
      sql`${t.format} in ${enumValues(exportFormats)}`
    ),
    foreignKey({
      columns: [t.projectId, t.bookId],
      foreignColumns: [books.projectId, books.id],
      name: 'book_export_book_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'book_export_scope_fk',
    }).onDelete('restrict'),
    index('book_export_book_idx').on(
      t.projectId,
      t.bookId,
      t.exportedAt.desc()
    ),
  ]
);
