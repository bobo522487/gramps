import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  LivingStatus,
  NameStatus,
  PersonNameType,
  PersonSex,
  PrivacyLevel,
} from '../../genealogy/constants';
import {
  LIVING_STATUS_VALUES,
  NAME_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
  PRIVACY_LEVEL_VALUES,
} from '../../genealogy/constants';
import { projects } from './project';
import { timestamptz, uuidPk } from './shared';

/**
 * Renders a closed value set as a SQL literal list for a CHECK constraint.
 *
 * The values always come from `lib/genealogy/constants.ts`, never from a user,
 * so building the list with `sql.raw` is safe here; the alternative — copying
 * the literals by hand — is exactly what lets the DDL and the TypeScript union
 * drift. `readCheckConstraintValues` asserts the two stay equal.
 */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * A person fact, independent of the lineage tree.
 *
 * `primary_name_id` is deliberately not a Drizzle foreign key: the target key
 * is `person_name (organization_id, person_id, id)`, which only exists once
 * `person_name` does, and the two tables would then reference each other.
 * `0017_fact_person_rls.sql` adds `fk_person_primary_name` by hand.
 */
export const persons = pgTable(
  'person',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sex: text('sex').$type<PersonSex>().notNull(),
    livingStatus: text('living_status').$type<LivingStatus>().notNull(),
    /** Set once a human confirms the status; the backfill must not overwrite it. */
    livingStatusLocked: boolean('living_status_locked')
      .notNull()
      .default(false),
    privacyLevel: text('privacy_level').$type<PrivacyLevel>().notNull(),
    nameStatus: text('name_status').$type<NameStatus>().notNull(),
    primaryNameId: uuid('primary_name_id'),
    /** Soft merge: the duplicate points at the surviving person in the same project. */
    mergedIntoId: uuid('merged_into_id'),
    sortKey: text('sort_key'),
    /** `node.id` this person was backfilled from (Task 7); never a foreign key. */
    legacyNodeId: uuid('legacy_node_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_person_project',
    }).onDelete('restrict'),
    // Target of both self-references below: a merge target must live in the
    // same organization AND the same project.
    unique('uk_person_organization_project_id').on(t.orgId, t.projectId, t.id),
    foreignKey({
      columns: [t.orgId, t.projectId, t.mergedIntoId],
      foreignColumns: [t.orgId, t.projectId, t.id],
      name: 'fk_person_merged_into_same_project',
    }).onDelete('restrict'),
    // One person per legacy node, so Task 7's backfill is re-runnable; a
    // soft-deleted person releases its node.
    uniqueIndex('uk_person_legacy_node')
      .on(t.orgId, t.projectId, t.legacyNodeId)
      .where(sql`${t.deletedAt} is null and ${t.legacyNodeId} is not null`),
    index('idx_person_project').on(t.orgId, t.projectId, t.deletedAt),
    index('idx_person_merged').on(t.orgId, t.projectId, t.mergedIntoId),
    check('ck_person_sex', sql`${t.sex} in ${valueSet(PERSON_SEX_VALUES)}`),
    check(
      'ck_person_living_status',
      sql`${t.livingStatus} in ${valueSet(LIVING_STATUS_VALUES)}`
    ),
    check(
      'ck_person_privacy_level',
      sql`${t.privacyLevel} in ${valueSet(PRIVACY_LEVEL_VALUES)}`
    ),
    check(
      'ck_person_name_status',
      sql`${t.nameStatus} in ${valueSet(NAME_STATUS_VALUES)}`
    ),
    check(
      'ck_person_not_self_merged',
      sql`${t.mergedIntoId} is distinct from ${t.id}`
    ),
  ]
);

/**
 * One recorded name of a person. A person with 名讳失考 has no usable name, so
 * `full_name` is nullable and the row may carry only what is known.
 */
export const personNames = pgTable(
  'person_name',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    personId: uuid('person_id').notNull(),
    nameType: text('name_type').$type<PersonNameType>().notNull(),
    /** Required when `name_type` is `other` (ck_person_name_custom_type). */
    customType: text('custom_type'),
    fullName: text('full_name'),
    surname: text('surname'),
    givenName: text('given_name'),
    namePrefix: text('name_prefix'),
    nameSuffix: text('name_suffix'),
    surnamePrefix: text('surname_prefix'),
    nickname: text('nickname'),
    pinyin: text('pinyin'),
    romanized: text('romanized'),
    /** BCP 47, e.g. `zh-Hans`. */
    language: varchar('language', { length: 35 }),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId, t.personId],
      foreignColumns: [persons.orgId, persons.projectId, persons.id],
      name: 'fk_person_name_person',
    }).onDelete('restrict'),
    // Target of fk_person_primary_name in 0017: a primary name must belong to
    // the same person, not merely to the same project.
    unique('uk_person_name_organization_person_id').on(
      t.orgId,
      t.personId,
      t.id
    ),
    // One row per (person, kind, position) among live names; a soft-deleted
    // name frees its slot. This is what makes the backfill idempotent.
    uniqueIndex('uk_person_name_type_order')
      .on(t.orgId, t.personId, t.nameType, t.sortOrder)
      .where(sql`${t.deletedAt} is null`),
    index('idx_person_name_person').on(t.orgId, t.personId, t.sortOrder),
    check(
      'ck_person_name_type',
      sql`${t.nameType} in ${valueSet(PERSON_NAME_TYPE_VALUES)}`
    ),
    check(
      'ck_person_name_custom_type',
      sql`${t.nameType} <> 'other' or ${t.customType} is not null`
    ),
  ]
);
