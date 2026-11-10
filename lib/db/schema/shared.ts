import { type SQL, sql } from 'drizzle-orm';
import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/** PostgreSQL ltree (extension installed by the baseline migration). */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'ltree';
  },
});

export const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

export const uuidPk = () => uuid('id').primaryKey().default(sql`uuidv7()`);

/**
 * Target-model `id` for tables whose primary key is the composite
 * `(project_id, id)` (appendix A.3/A.4). Drizzle rejects a column-level
 * `.primaryKey()` together with a table-level `primaryKey()`, so this helper
 * deliberately omits it: the owning table declares
 * `primaryKey({ columns: [t.projectId, t.id] })`.
 *
 * `uuidPk()` stays for tables that are still on the single-column key and are
 * rewritten in phase B.
 */
export const scopedUuid = () => uuid('id').notNull().default(sql`uuidv7()`);

/**
 * Quote a value as a single-quoted SQL string literal, doubling any embedded
 * single quote (SQL's standard escape). Values must come from code constants
 * (`lib/genealogy/constants.ts`), never user input — this only prevents a
 * literal with a `'` from producing malformed DDL at migrate time.
 */
export function quoteSqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Render a closed value set as a SQL literal list for a CHECK constraint, e.g.
 * `('a', 'b', 'c')`. Centralised here so the rule lives in one place instead of
 * the five copies that used to drift (`person`/`lineage`/`family`/`event`/
 * `book-export`). The values always come from code constants, so building the
 * list with `sql.raw` is safe; the alternative — copying the literals by hand —
 * is exactly what lets the DDL and the TypeScript union drift.
 * `readCheckConstraintValues` asserts the two stay equal.
 */
export function enumValues(values: readonly string[]): SQL {
  return sql.raw(`(${values.map(quoteSqlLiteral).join(', ')})`);
}
