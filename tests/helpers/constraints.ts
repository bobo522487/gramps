import type { ISql } from 'postgres';

/**
 * Reads the string literals out of a table's CHECK constraint definition, so a
 * test can assert "the values in `lib/genealogy/constants.ts` are exactly the
 * values the database accepts" (blueprint §7.6). Only CHECK constraints are
 * considered: a UNIQUE/FK constraint with the same name is reported as missing.
 * The result is sorted, which lets callers compare against
 * `[...SOME_VALUES].sort()` without caring about the order Postgres printed.
 *
 * Both literal casts Postgres emits are recognised: `'value'::text`, and
 * `'value'::character varying` — the shape a `varchar` column produces, e.g.
 * `(name_type)::text = ANY ((ARRAY['birth'::character varying, …])::text[])`.
 *
 * Only call this on the constraint that *defines* the enum. A negative
 * constraint returns the values it *excludes*: on PostgreSQL 18,
 * `name_type <> 'other' or custom_type is not null` yields `['other']` and
 * `name_type NOT IN ('between','period')` yields both of those. A CHECK that
 * compares against a column or a function, or contains no literal at all,
 * yields `[]`, so the caller's equality assertion fails loudly instead of
 * passing vacuously.
 */
export async function readCheckConstraintValues(
  sql: ISql,
  table: string,
  constraintName: string
): Promise<string[]> {
  const [row] = await sql<{ def: string }[]>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = ${table}::regclass
      AND conname = ${constraintName}
      AND contype = 'c'`;
  if (!row) {
    throw new Error(`constraint ${constraintName} not found on ${table}`);
  }
  return [...row.def.matchAll(/'([^']*)'::(?:text|character varying)/g)]
    .map((match) => match[1])
    .sort();
}
