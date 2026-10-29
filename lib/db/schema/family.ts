import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  ParentageType,
  PartnerRole,
  PartnerStatus,
  UnionType,
} from '../../genealogy/constants';
import {
  PARENTAGE_TYPE_VALUES,
  PARTNER_ROLE_VALUES,
  PARTNER_STATUS_VALUES,
  UNION_TYPE_VALUES,
} from '../../genealogy/constants';
import { persons } from './person';
import { projects } from './project';
import { timestamptz, uuidPk } from './shared';

/**
 * Renders a closed value set as a SQL literal list for a CHECK constraint.
 *
 * Same helper as `lib/db/schema/person.ts`: the values always come from
 * `lib/genealogy/constants.ts`, never from a user, so building the list with
 * `sql.raw` is safe here; copying the literals by hand is exactly what lets the
 * DDL and the TypeScript union drift. `readCheckConstraintValues` asserts the
 * two stay equal.
 */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * One union (婚配/家庭) in a project.
 *
 * A family is the join row between people, not a person: `family_partner`
 * carries the 血亲/姻亲 sides and `family_child` the children, so 兼祧/过继 (one
 * person is a child of two families) and a spouse whose own family is unknown
 * are both representable without inventing rows on `person`.
 *
 * The "at most one blood partner" rule is NOT a CHECK here: it is a cross-row
 * invariant and lives in `app.check_family_blood_side()` (0019). The lower
 * bound ("at least one") is deliberately not enforced at all — see that
 * function's comment.
 */
export const families = pgTable(
  'family',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    unionType: varchar('union_type', { length: 20 })
      .$type<UnionType>()
      .notNull()
      .default('unknown'),
    sort: integer('sort').notNull().default(0),
    notes: text('notes'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_family_project',
    }).onDelete('restrict'),
    // Target of the composite keys in family_partner/family_child below: a
    // partner or child must hang off a family in the same organization AND the
    // same project, and Tasks 6/7 need a three-column key to reference.
    unique('uk_family_organization_project_id').on(t.orgId, t.projectId, t.id),
    index('idx_family_project').on(t.orgId, t.projectId, t.deletedAt),
    check(
      'ck_family_union_type',
      sql`${t.unionType} in ${valueSet(UNION_TYPE_VALUES)}`
    ),
  ]
);

/**
 * One side of a union: `blood` is 血亲/本宗, `spouse` is 姻亲.
 *
 * `partner_order` records which side is written first (1 = 夫/本宗 side by
 * convention), because a union has no other stable ordering. `status` is the
 * union's state as seen from this partner (widowed/divorced), which is why it
 * lives here and not on `family`.
 */
export const familyPartners = pgTable(
  'family_partner',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    familyId: uuid('family_id').notNull(),
    personId: uuid('person_id').notNull(),
    role: text('role').$type<PartnerRole>().notNull(),
    partnerOrder: smallint('partner_order').notNull().default(1),
    status: varchar('status', { length: 20 })
      .$type<PartnerStatus>()
      .notNull()
      .default('unknown'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_family_partner_project',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId, t.familyId],
      foreignColumns: [families.orgId, families.projectId, families.id],
      name: 'fk_family_partner_family',
    }).onDelete('restrict'),
    // Composite, not a plain person_id reference: the partner must be a person
    // of the same project, otherwise a family could point at another project's
    // person while both keys exist.
    foreignKey({
      columns: [t.orgId, t.projectId, t.personId],
      foreignColumns: [persons.orgId, persons.projectId, persons.id],
      name: 'fk_family_partner_person',
    }).onDelete('restrict'),
    unique('uk_family_partner_organization_project_id').on(
      t.orgId,
      t.projectId,
      t.id
    ),
    // One row per person per family among live rows; dissolving a union is a
    // soft delete and releases the slot. Note this is (family, person), NOT
    // (person): 兼祧/过继 means one person belongs to DIFFERENT families.
    uniqueIndex('uk_family_partner_family_person')
      .on(t.orgId, t.familyId, t.personId)
      .where(sql`${t.deletedAt} is null`),
    index('idx_family_partner_person').on(t.orgId, t.projectId, t.personId),
    check(
      'ck_family_partner_role',
      sql`${t.role} in ${valueSet(PARTNER_ROLE_VALUES)}`
    ),
    check(
      'ck_family_partner_status',
      sql`${t.status} in ${valueSet(PARTNER_STATUS_VALUES)}`
    ),
  ]
);

/**
 * One child of a union. `parentage_type` separates 嫡出/庶出/过继/养子 from the
 * biological default, and `is_primary` marks the family the child is chiefly
 * recorded under when they are a child of several (兼祧).
 */
export const familyChildren = pgTable(
  'family_child',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    familyId: uuid('family_id').notNull(),
    personId: uuid('person_id').notNull(),
    parentageType: varchar('parentage_type', { length: 20 })
      .$type<ParentageType>()
      .notNull()
      .default('birth'),
    isPrimary: boolean('is_primary').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_family_child_project',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId, t.familyId],
      foreignColumns: [families.orgId, families.projectId, families.id],
      name: 'fk_family_child_family',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId, t.personId],
      foreignColumns: [persons.orgId, persons.projectId, persons.id],
      name: 'fk_family_child_person',
    }).onDelete('restrict'),
    unique('uk_family_child_organization_project_id').on(
      t.orgId,
      t.projectId,
      t.id
    ),
    // One child row per person per family among live rows; 兼祧/过继 is the
    // same person in two DIFFERENT families, which this key allows.
    uniqueIndex('uk_family_child_family_person')
      .on(t.orgId, t.familyId, t.personId)
      .where(sql`${t.deletedAt} is null`),
    index('idx_family_child_person').on(t.orgId, t.projectId, t.personId),
    check(
      'ck_family_child_parentage_type',
      sql`${t.parentageType} in ${valueSet(PARENTAGE_TYPE_VALUES)}`
    ),
  ]
);
