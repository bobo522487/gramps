import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { persons } from './person';
import { projects } from './project';
import { scopedUuid, timestamptz } from './shared';

/**
 * CHECK domains below are copied from appendix A.3 (168–240) of the target
 * DDL, which is the single source of truth. They are local because the Drizzle
 * schema is an expression of that DDL, not a second public value-set API; the
 * phase-B SQL baseline is what actually enforces them.
 */
const partnerRoles = [
  'husband',
  'wife',
  'concubine',
  'partner',
  'unknown',
] as const;
const childKinds = [
  'biological',
  'adopted',
  'step',
  'foster',
  'ritual_heir',
  'unknown',
] as const;

/** Renders a closed value set as a SQL literal list for a CHECK constraint. */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * One union (婚配/家庭). A family is a join row, not a person: partners and
 * children hang off it through the two tables below (appendix A.3).
 */
export const families = pgTable(
  'family',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'family_scope_fk',
    }).onDelete('restrict'),
  ]
);

/**
 * One side of a union. `rank` is scoped by `role`, so a husband and a wife may
 * each hold rank 1; the four-column unique is the reference target of the
 * mother key in `family_child`.
 */
export const familyPartners = pgTable(
  'family_partner',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    familyId: uuid('family_id').notNull(),
    personId: uuid('person_id').notNull(),
    role: text('role')
      .$type<(typeof partnerRoles)[number]>()
      .notNull()
      .default('partner'),
    roleLabel: text('role_label'),
    rank: smallint('rank'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('family_partner_unique').on(t.projectId, t.familyId, t.personId),
    unique('family_partner_role_unique').on(
      t.projectId,
      t.familyId,
      t.personId,
      t.role
    ),
    unique('family_partner_rank_unique').on(
      t.projectId,
      t.familyId,
      t.role,
      t.rank
    ),
    foreignKey({
      columns: [t.projectId, t.familyId],
      foreignColumns: [families.projectId, families.id],
      name: 'family_partner_family_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.personId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'family_partner_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'family_partner_scope_fk',
    }).onDelete('restrict'),
    index('family_partner_person_idx').on(t.projectId, t.personId),
    check('family_partner_role', sql`${t.role} in ${valueSet(partnerRoles)}`),
    check(
      'family_partner_rank_positive',
      sql`${t.rank} is null or ${t.rank} > 0`
    ),
  ]
);

/**
 * One child of a union. The mother reference is a four-column key into
 * `family_partner`: a mother must match both the person and the role in that
 * same family. `MATCH SIMPLE` skips a composite FK whenever any column is
 * NULL, so the pair CHECK forces the two halves to be present together.
 */
export const familyChildren = pgTable(
  'family_child',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    familyId: uuid('family_id').notNull(),
    personId: uuid('person_id').notNull(),
    kind: text('kind')
      .$type<(typeof childKinds)[number]>()
      .notNull()
      .default('biological'),
    motherPersonId: uuid('mother_person_id'),
    motherRole: text('mother_role'),
    originFamilyId: uuid('origin_family_id'),
    birthOrder: integer('birth_order'),
    birthOrderLabel: text('birth_order_label'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    unique('family_child_unique').on(t.projectId, t.familyId, t.personId),
    check(
      'family_child_mother_pair',
      sql`(${t.motherPersonId} is null) = (${t.motherRole} is null)`
    ),
    check(
      'family_child_origin_distinct',
      sql`${t.originFamilyId} is null or ${t.originFamilyId} <> ${t.familyId}`
    ),
    check(
      'family_child_origin_kind',
      sql`${t.originFamilyId} is null or ${t.kind} in ('adopted', 'ritual_heir')`
    ),
    foreignKey({
      columns: [t.projectId, t.familyId],
      foreignColumns: [families.projectId, families.id],
      name: 'family_child_family_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.personId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'family_child_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.familyId, t.motherPersonId, t.motherRole],
      foreignColumns: [
        familyPartners.projectId,
        familyPartners.familyId,
        familyPartners.personId,
        familyPartners.role,
      ],
      name: 'family_child_mother_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.originFamilyId],
      foreignColumns: [families.projectId, families.id],
      name: 'family_child_origin_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'family_child_scope_fk',
    }).onDelete('restrict'),
    index('family_child_person_idx').on(t.projectId, t.personId),
    check('family_child_kind', sql`${t.kind} in ${valueSet(childKinds)}`),
    check(
      'family_child_mother_role',
      sql`${t.motherRole} in ('wife', 'concubine')`
    ),
    check(
      'family_child_birth_order_positive',
      sql`${t.birthOrder} is null or ${t.birthOrder} > 0`
    ),
  ]
);
