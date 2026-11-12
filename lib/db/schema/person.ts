import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { PersonNameType, PersonSex } from '../../genealogy/constants';
import {
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
} from '../../genealogy/constants';
import { projects } from './project';
import { enumValues, scopedUuid, timestamptz } from './shared';

/**
 * A person fact, independent of the lineage tree (appendix A.3).
 *
 * The target shape is intentionally tiny: a person is an identity, `sex`, and
 * an optional `surname`. Given names live in `person_name`.
 * Names live in `person_name`, dated facts in `event`, and tree placement in
 * `node`. All four tables share the `(project_id, id)` composite key, so every
 * cross-table reference carries `project_id` and cannot cross projects.
 */
export const persons = pgTable(
  'person',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    sex: text('sex').$type<PersonSex>().notNull().default('unknown'),
    surname: text('surname'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('person_id_global').on(t.id),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'person_scope_fk',
    }).onDelete('restrict'),
    check(
      'person_sex_check',
      sql`${t.sex} in ${enumValues(PERSON_SEX_VALUES)}`
    ),
    check(
      'person_surname_present',
      sql`${t.surname} IS NULL OR btrim(${t.surname}) <> ''`
    ),
  ]
);

/**
 * One recorded name of a person (appendix A.3). `kind` names the naming
 * convention, `value` is the text as written; the single display name is the
 * `is_primary` row, enforced by a partial unique index.
 */
export const personNames = pgTable(
  'person_name',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    personId: uuid('person_id').notNull(),
    kind: text('kind').$type<PersonNameType>().notNull().default('given'),
    value: text('value').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('person_name_id_global').on(t.id),
    unique('person_name_unique').on(t.projectId, t.personId, t.kind, t.value),
    foreignKey({
      columns: [t.projectId, t.personId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'person_name_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'person_name_scope_fk',
    }).onDelete('restrict'),
    index('person_name_person_idx').on(t.projectId, t.personId, t.kind),
    uniqueIndex('person_name_one_primary')
      .on(t.projectId, t.personId)
      .where(sql`${t.isPrimary}`),
    check(
      'person_name_kind',
      sql`${t.kind} in ${enumValues(PERSON_NAME_TYPE_VALUES)}`
    ),
    check('person_name_value_not_blank', sql`btrim(${t.value}) <> ''`),
  ]
);
