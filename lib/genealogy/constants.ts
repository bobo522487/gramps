/**
 * Closed value sets for the target-model genealogy fact layer.
 *
 * Each set is a flat `as const` array of `lower_snake_case` strings so the same
 * list drives the TypeScript union, Zod validation and the database CHECK
 * constraint (`readCheckConstraintValues` asserts the two stay equal). Adding a
 * value is therefore a migration, never a silent widening.
 *
 * The three sets below are exactly the CHECK domains in appendix A.3
 * (`gramps-S8-目标DDL.sql` 135–274): `person.sex`, `person_name.kind` and
 * `event.kind`. The former 13 sets belonged to the retired backfill-snapshot
 * shape and were removed in S8 stage A′; they have no target-model column.
 */

// --- person ----------------------------------------------------------------

/** GEDCOM `SEX`; `other` covers recorded-but-unstated, `unknown` covers 失考. */
export const PERSON_SEX_VALUES = [
  'male',
  'female',
  'other',
  'unknown',
] as const;
export type PersonSex = (typeof PERSON_SEX_VALUES)[number];

/**
 * `person_name.kind`: 名 `given`, 字 `courtesy`, 号 `art`, 乳名 `milk`,
 * 谱名 `genealogy`, 谥 `posthumous`, 其他 `other` (appendix A.3).
 */
export const PERSON_NAME_TYPE_VALUES = [
  'given',
  'courtesy',
  'art',
  'milk',
  'genealogy',
  'posthumous',
  'other',
] as const;
export type PersonNameType = (typeof PERSON_NAME_TYPE_VALUES)[number];

// --- events ----------------------------------------------------------------

/**
 * `event.kind` (appendix A.3): the eleven recorded fact kinds. This is a
 * single flat domain now — the retired `event_kind` / `event_type` /
 * `attribute_event_type` split has no target-model column.
 */
export const EVENT_KIND_VALUES = [
  'birth',
  'death',
  'burial',
  'marriage',
  'divorce',
  'adoption',
  'heir_transfer',
  'migration',
  'office',
  'exam',
  'other',
] as const;
export type EventKind = (typeof EVENT_KIND_VALUES)[number];
