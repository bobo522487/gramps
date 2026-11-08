import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { EventKind } from '../../genealogy/constants';
import { EVENT_KIND_VALUES } from '../../genealogy/constants';
import { families } from './family';
import { persons } from './person';
import { projects } from './project';
import { scopedUuid, timestamptz } from './shared';

/** Renders a closed value set as a SQL literal list for a CHECK constraint. */
function valueSet(values: readonly string[]) {
  return sql.raw(`(${values.map((value) => `'${value}'`).join(', ')})`);
}

/**
 * One recorded fact about a person or a union (appendix A.3, 242–274).
 *
 * Exactly one of `personId` / `familyId` is set; the kind additionally decides
 * which half is legal. `dateText` keeps the date as written while `dateSort`
 * is the optional ISO-shaped sort key — a sort key without text is forbidden.
 * Birth and death are at most one per person, enforced by partial unique
 * indexes rather than application logic.
 */
export const events = pgTable(
  'event',
  {
    id: scopedUuid(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: text('kind').$type<EventKind>().notNull(),
    personId: uuid('person_id'),
    familyId: uuid('family_id'),
    dateText: text('date_text'),
    dateSort: text('date_sort'),
    placeText: text('place_text'),
    summary: text('summary'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.id] }),
    check(
      'event_one_subject',
      sql`num_nonnulls(${t.personId}, ${t.familyId}) = 1`
    ),
    check(
      'event_person_kinds',
      sql`${t.kind} not in ('birth', 'death', 'burial', 'migration', 'office', 'exam') or ${t.personId} is not null`
    ),
    check(
      'event_family_kinds',
      sql`${t.kind} not in ('marriage', 'divorce') or ${t.familyId} is not null`
    ),
    check(
      'event_sort_needs_text',
      sql`${t.dateSort} is null or ${t.dateText} is not null`
    ),
    check(
      'event_domain_check',
      sql`${t.kind} in ${valueSet(EVENT_KIND_VALUES)}`
    ),
    check(
      'event_date_sort_format',
      sql`${t.dateSort} is null or ${t.dateSort} ~ '^[0-9]{4}(-[0-9]{2})?(-[0-9]{2})?$'`
    ),
    foreignKey({
      columns: [t.projectId, t.personId],
      foreignColumns: [persons.projectId, persons.id],
      name: 'event_person_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.projectId, t.familyId],
      foreignColumns: [families.projectId, families.id],
      name: 'event_family_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'event_scope_fk',
    }).onDelete('restrict'),
    index('event_person_date_idx').on(t.projectId, t.personId, t.dateSort),
    index('event_family_date_idx').on(t.projectId, t.familyId, t.dateSort),
    uniqueIndex('event_one_birth')
      .on(t.projectId, t.personId)
      .where(sql`${t.kind} = 'birth'`),
    uniqueIndex('event_one_death')
      .on(t.projectId, t.personId)
      .where(sql`${t.kind} = 'death'`),
  ]
);
