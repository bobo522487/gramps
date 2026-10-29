import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Calendar,
  DatePrecision,
  DateQualifier,
  EventKind,
  EventType,
} from '../../genealogy/constants';
import {
  ATTRIBUTE_EVENT_TYPE_VALUES,
  CALENDAR_VALUES,
  DATE_PRECISION_VALUES,
  DATE_QUALIFIER_VALUES,
  EVENT_KIND_VALUES,
  EVENT_TYPE_VALUES,
} from '../../genealogy/constants';
import { families } from './family';
import { persons } from './person';
import { projects } from './project';
import { timestamptz, uuidPk } from './shared';

/**
 * Renders a closed value set as a SQL literal list for a CHECK constraint.
 *
 * Same helper as `lib/db/schema/person.ts` and `family.ts`: the values always
 * come from `lib/genealogy/constants.ts`, never from a user, so building the
 * list with `sql.raw` is safe here; copying the literals by hand is exactly what
 * lets the DDL and the TypeScript union drift. `readCheckConstraintValues`
 * asserts the two stay equal.
 */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * One recorded fact about a person or a union.
 *
 * ## The subject is a two-way choice in P1
 *
 * `person_id` XOR `family_id` (`ck_event_subject_exactly_one`). The third
 * subject — `placement_id`, the join row between a person and a lineage node —
 * and the generated `subject_type` column that names the winner arrive in P2,
 * together with `person_placement` itself; that migration drops and rebuilds
 * this CHECK and the generated column. The two-way shape here is a phase, not an
 * oversight: a fact with no subject at all cannot be put on a timeline, exported
 * or merged, and a fact with both subjects exists twice.
 *
 * ## Dates are five constraints, not one
 *
 * RLS, the tenant-immutability trigger and the date matrix live in
 * `0021_fact_event_rls.sql`, because the matrix is a hand-written combination
 * rule Drizzle cannot generate. Five separate CHECKs
 * (`ck_event_date_point`, `_before`, `_after`, `_between`, `_unknown`) cover all
 * nine `DATE_QUALIFIER_VALUES` members; they stay separate because `before` and
 * `after` legitimately carry exactly one bound, and a merged constraint would
 * force a fake second bound. `calculated` belongs to the point set alongside
 * `exact`/`about`/`estimated`.
 *
 * `date_original` is nullable and carries no NOT NULL check: an event can be
 * known only by its place or only by its description (葬地已知、卒年失考 is the
 * normal case in Chinese genealogy), and `node` has no burial date at all. The
 * "no date" state is `date_qualifier = 'unknown'` with both bounds NULL;
 * `date_qualifier` is NOT NULL precisely so that state cannot be expressed by
 * leaving the qualifier NULL, which would satisfy every matrix CHECK vacuously.
 * For the same reason `date_qualifier`, `date_precision` and `calendar` each
 * carry an enum CHECK generated from `lib/genealogy/constants.ts`
 * (`ck_event_date_qualifier`, `ck_event_date_precision`, `ck_event_calendar`):
 * a qualifier outside the set satisfies every matrix CHECK just as a NULL one
 * would, and the matrix would guard nothing.
 *
 * ## Kind and type
 *
 * `event_kind` mirrors GEDCOM 7's second axis (event vs attribute) and must
 * agree with `event_type`: `ck_event_kind_matches_type` is
 * `(event_kind = 'attribute') = (event_type IN (ATTRIBUTE_EVENT_TYPE_VALUES))`,
 * generated from the same list as the TypeScript union. `custom` and `other` are
 * type fallbacks, not attributes (see the note on `ATTRIBUTE_EVENT_TYPE_VALUES`),
 * so a custom *event* is `event_type = 'custom'` + `custom_type` (GEDCOM 7
 * EVEN + TYPE) and a custom *attribute* is `event_type = 'fact'` +
 * `custom_type` (FACT + TYPE). `ck_event_custom_type` therefore keys off
 * `event_type` only, never off `event_kind`.
 *
 * The three indexes are non-partial on purpose, like the other business tables:
 * soft-delete filtering lives in the queries (`deleted_at is null`), not in the
 * index definitions.
 */
export const events = pgTable(
  'event',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    /** Subject half one; exactly one of `person_id`/`family_id` is set. */
    personId: uuid('person_id'),
    /** Subject half two: 婚配/离婚 and other union facts hang off the family. */
    familyId: uuid('family_id'),
    eventKind: text('event_kind').$type<EventKind>().notNull().default('event'),
    eventType: text('event_type').$type<EventType>().notNull().default('event'),
    /** Required when `event_type` is `custom` (ck_event_custom_type). */
    customType: text('custom_type'),
    /** Original GEDCOM tag, kept so an import can round-trip a fact it cannot map. */
    gedcomTag: text('gedcom_tag'),
    title: text('title'),
    /** The attribute's value (官衔、职业名) or a short event value. */
    value: text('value'),
    description: text('description'),
    /**
     * The date as the source wrote it (`康熙三十年`). Nullable: an event may be
     * known only by place or description. `date_start`/`date_end` are the
     * derived, queryable bounds and never replace this text.
     */
    dateOriginal: text('date_original'),
    dateStart: date('date_start'),
    dateEnd: date('date_end'),
    /** Display granularity only; never changes the stored bounds. */
    datePrecision: text('date_precision').$type<DatePrecision>(),
    /** NOT NULL: NULL would satisfy every date matrix CHECK vacuously. */
    dateQualifier: text('date_qualifier')
      .$type<DateQualifier>()
      .notNull()
      .default('unknown'),
    calendar: text('calendar').$type<Calendar>().notNull().default('gregorian'),
    /**
     * The original lunar date structure, stored as written. P1 keeps no
     * lunar-to-Gregorian conversion here, so a row may carry `date_cn` with both
     * bounds NULL and `date_qualifier = 'unknown'`.
     */
    dateCn: jsonb('date_cn'),
    /** `享年七十有三` as recorded, next to the parsed pair below. */
    ageText: text('age_text'),
    ageYears: smallint('age_years'),
    /** How `age_years` was derived (stated/explicit/computed). All-or-nothing. */
    ageBasis: text('age_basis'),
    /** Burial place, 迁居 place, …: P1 keeps the text, `place` arrives in P3. */
    placeOriginal: text('place_original'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_event_project',
    }).onDelete('restrict'),
    // Composite keys, not plain id references: the subject must be a person (or
    // family) of the same organization AND the same project. MATCH SIMPLE (the
    // default) skips the check while the column is NULL, which is what makes the
    // XOR subject work with two separate keys.
    foreignKey({
      columns: [t.orgId, t.projectId, t.personId],
      foreignColumns: [persons.orgId, persons.projectId, persons.id],
      name: 'fk_event_person',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId, t.familyId],
      foreignColumns: [families.orgId, families.projectId, families.id],
      name: 'fk_event_family',
    }).onDelete('restrict'),
    // Target of the P4 event_participant / P6 association keys: a participant
    // must belong to the same organization AND the same project as its event.
    unique('uk_event_organization_project_id').on(t.orgId, t.projectId, t.id),
    // Timeline query: one person's facts in date order.
    index('idx_event_subject').on(
      t.orgId,
      t.projectId,
      t.personId,
      t.dateStart
    ),
    // Union facts (婚配/离婚) hang off the family side.
    index('idx_event_family').on(t.orgId, t.projectId, t.familyId),
    // Type rollups ("every 科举 event in this project").
    index('idx_event_type').on(t.orgId, t.projectId, t.eventType),
    check(
      'ck_event_type',
      sql`${t.eventType} in ${valueSet(EVENT_TYPE_VALUES)}`
    ),
    check(
      'ck_event_kind',
      sql`${t.eventKind} in ${valueSet(EVENT_KIND_VALUES)}`
    ),
    // The three date enums are CHECKed for the same reason `date_qualifier` is
    // NOT NULL: every constraint in the 0021 matrix is written as
    // `date_qualifier <> 'x' OR (…)`, so a qualifier outside the closed set
    // matches none of them and satisfies all five. Without these, a row with
    // `date_qualifier = 'circa'` could carry any bounds at all — inverted, or
    // both bounds while claiming `before` — and the date matrix would guard
    // nothing. The same applies to `date_precision` and `calendar`, which are
    // otherwise unchecked text columns.
    check(
      'ck_event_date_qualifier',
      sql`${t.dateQualifier} in ${valueSet(DATE_QUALIFIER_VALUES)}`
    ),
    // Nullable, and `IN` is NULL-tolerant: a row with no precision passes, a row
    // with an invented precision does not.
    check(
      'ck_event_date_precision',
      sql`${t.datePrecision} in ${valueSet(DATE_PRECISION_VALUES)}`
    ),
    check(
      'ck_event_calendar',
      sql`${t.calendar} in ${valueSet(CALENDAR_VALUES)}`
    ),
    check(
      'ck_event_kind_matches_type',
      sql`(${t.eventKind} = 'attribute') = (${t.eventType} in ${valueSet(ATTRIBUTE_EVENT_TYPE_VALUES)})`
    ),
    // XOR subject: a fact needs one owner, and never two.
    check(
      'ck_event_subject_exactly_one',
      sql`num_nonnulls(${t.personId}, ${t.familyId}) = 1`
    ),
    check(
      'ck_event_custom_type',
      sql`${t.eventType} <> 'custom' or ${t.customType} is not null`
    ),
    // Age is all-or-nothing: "73 years old, basis unknown" is not a recorded
    // fact, and a basis with no number is a derivation with no result.
    check(
      'ck_event_age_pair',
      sql`(${t.ageYears} is null) = (${t.ageBasis} is null)`
    ),
  ]
);
