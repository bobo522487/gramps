import type { Sql } from 'postgres';

/**
 * Reads the string literals out of a table's CHECK constraint definition, so a
 * test can assert "the values in `lib/genealogy/constants.ts` are exactly the
 * values the database accepts" (blueprint §7.6). The result is sorted, which
 * lets callers compare against `[...SOME_VALUES].sort()` without caring about
 * the order Postgres happened to print.
 *
 * Only literal comparisons of the form `'value'::text` are picked up; a CHECK
 * that compares against a column or a function contributes nothing, and the
 * caller's equality assertion then fails loudly instead of passing vacuously.
 */
export async function readCheckConstraintValues(
  sql: Sql,
  table: string,
  constraintName: string
): Promise<string[]> {
  const [row] = await sql<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass AND conname = ${constraintName}`;
  if (!row) {
    throw new Error(`constraint ${constraintName} not found on ${table}`);
  }
  return [...row.def.matchAll(/'([^']*)'::(?:text|character varying)/g)]
    .map((match) => match[1])
    .sort();
}
