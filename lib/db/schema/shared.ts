import { sql } from 'drizzle-orm';
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
