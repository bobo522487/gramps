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
