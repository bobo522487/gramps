import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { events } from '@/lib/db/schema';
import {
  ATTRIBUTE_EVENT_TYPE_VALUES,
  EVENT_KIND_VALUES,
  EVENT_TYPE_VALUES,
} from '@/lib/genealogy/constants';
import { readCheckConstraintValues } from '../helpers/constraints';
import { getTestSql, pgErrorCode, pgErrorMessages } from '../helpers/db';
import {
  addMember,
  createEvent,
  createFamily,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

// The event fact layer: one row per recorded fact about a person or a union.
// Everything here is asserted against a real database, because the rules this
// file exists for are database rules: the subject is exactly one of
// person/family, the date boundary matrix is five CHECKs (not one merged
// constraint — `before`/`after` legitimately carry a single bound), the age pair
// is all-or-nothing, `custom` must name itself, and the tenant boundary (RLS +
// the immutability trigger) keeps one organization's events out of another's.
//
// Two states get their own cases because they are the normal case in Chinese
// genealogy, not edge cases: an event known only by its place (葬地已知、卒年失考)
// has no date at all, and a date may be recorded only as original text.

function isCheckViolation(constraint: string) {
  return (error: unknown) =>
    pgErrorCode(error) === '23514' &&
    pgErrorMessages(error).some((message) => message.includes(constraint));
}

/** Owner/editor/viewer of a fresh organization plus one project and person. */
async function eventScope(role: 'owner' | 'editor' | 'viewer' = 'owner') {
  const user = await createUser();
  const organization = await createOrganization();
  await addMember({
    userId: user.id,
    organizationId: organization.id,
    role,
  });
  const project = await createProject({
    orgId: organization.id,
    createdBy: user.id,
  });
  const person = await createPerson({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
  });
  return {
    user,
    organization,
    project,
    person,
    scope: {
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    },
  };
}

describe('event subject and tenant keys', () => {
  it('requires exactly one subject: a person or a union', async () => {
    const { scope, person } = await eventScope();

    // ck_event_subject_exactly_one: num_nonnulls(person_id, family_id) = 1.
    // Zero subjects is what the attachment allowed and the review rejected: a
    // fact with no subject cannot be put on a timeline or exported.
    await expect(createEvent({ ...scope, personId: null })).rejects.toSatisfy(
      isCheckViolation('ck_event_subject_exactly_one')
    );

    const family = await createFamily(scope);

    // Both subjects is the duplicate representation: the same 婚配 would exist
    // twice, once on each subject.
    await expect(
      createEvent({ ...scope, personId: person.id, familyId: family.id })
    ).rejects.toSatisfy(isCheckViolation('ck_event_subject_exactly_one'));

    // The family side of the two-way choice is real (婚配/离婚 are family
    // events), so it must insert.
    const marriage = await createEvent({
      ...scope,
      familyId: family.id,
      eventType: 'marriage',
    });
    expect(marriage.familyId).toBe(family.id);
    expect(marriage.personId).toBeNull();
  });

  it('refuses a person or family from another project', async () => {
    const { user, organization, project, scope } = await eventScope();
    const otherProject = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    // Same organization, different project: only the composite
    // (organization_id, project_id, person_id) key can refuse this.
    const foreignPerson = await createPerson({
      orgId: organization.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });
    const foreignFamily = await createFamily({
      orgId: organization.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });

    await expect(
      createEvent({ ...scope, personId: foreignPerson.id })
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '23503' &&
        pgErrorMessages(error).some((message) =>
          message.includes('fk_event_person')
        )
    );

    await expect(
      createEvent({
        ...scope,
        personId: null,
        familyId: foreignFamily.id,
        eventType: 'marriage',
      })
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '23503' &&
        pgErrorMessages(error).some((message) =>
          message.includes('fk_event_family')
        )
    );

    // Companion case: a second person in the *same* project inserts normally,
    // so the refusals above come from the composite key, not from the person
    // table.
    const sameProject = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await expect(
      createEvent({ ...scope, personId: sameProject.id })
    ).resolves.toBeTruthy();
  });
});

describe('event date boundary matrix', () => {
  it('stores an event that is known only by its place (no date at all)', async () => {
    const { scope, person } = await eventScope();

    // 葬地已知、卒年失考: `node` carries a burial place and no date, so the
    // backfill must be able to write an event whose date columns are all empty.
    // `date_original` is nullable for exactly this reason; inventing a date
    // string to satisfy a NOT NULL column is the placeholder-data defect the
    // v1.0 review criticised.
    const burial = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'burial',
      placeOriginal: '葬于村东祖坟',
      dateOriginal: null,
      dateQualifier: 'unknown',
    });

    expect(burial.dateOriginal).toBeNull();
    expect(burial.dateStart).toBeNull();
    expect(burial.dateEnd).toBeNull();
    expect(burial.dateQualifier).toBe('unknown');
    expect(burial.placeOriginal).toBe('葬于村东祖坟');
  });

  it('defaults the qualifier to unknown rather than leaving it NULL', async () => {
    const { scope, person } = await eventScope();

    // date_qualifier is NOT NULL: a NULL qualifier would satisfy every one of
    // the five matrix CHECKs vacuously (`qualifier IS NULL` is never a match, so
    // each constraint passes), and the whole matrix would guard nothing.
    const event = await createEvent({ ...scope, personId: person.id });
    expect(event.dateQualifier).toBe('unknown');

    await expect(
      getTestSql()`
        insert into event
          (organization_id, project_id, person_id, event_type, date_qualifier, created_by)
        values
          (${scope.orgId}, ${scope.projectId}, ${person.id}, 'birth', null, ${scope.createdBy})`
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23502');
  });

  it('keeps the original date text when the bounds carry the interval', async () => {
    const { scope, person } = await eventScope();

    // '康熙三十年' is what the source says; the interval is the derived,
    // queryable half. Both must survive, and precision only describes the
    // display granularity — it never changes the bounds.
    const event = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'birth',
      dateOriginal: '康熙三十年',
      dateStart: '1691-01-01',
      dateEnd: '1691-12-31',
      datePrecision: 'year',
      dateQualifier: 'exact',
    });

    expect(event.dateOriginal).toBe('康熙三十年');
    expect(event.dateStart).toBe('1691-01-01');
    expect(event.dateEnd).toBe('1691-12-31');
    expect(event.datePrecision).toBe('year');
    expect(event.calendar).toBe('gregorian');
  });

  it('accepts "before 1691" only with the end bound', async () => {
    const { scope, person } = await eventScope();

    const before = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'death',
      dateOriginal: 'before 1691',
      dateStart: null,
      dateEnd: '1691-01-01',
      dateQualifier: 'before',
    });
    expect(before.dateStart).toBeNull();
    expect(before.dateEnd).toBe('1691-01-01');

    // A `before` row with a lower bound is the ambiguity the review found
    // ("before 1691" had two legal encodings): the lower bound is unknown by
    // definition, so storing one is a contradiction, not extra precision.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        dateStart: '1691-01-01',
        dateEnd: '1691-01-01',
        dateQualifier: 'before',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_before'));
  });

  it('accepts "after 1691" only with the start bound', async () => {
    const { scope, person } = await eventScope();

    const after = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'death',
      dateOriginal: 'after 1691',
      dateStart: '1691-01-01',
      dateEnd: null,
      dateQualifier: 'after',
    });
    expect(after.dateStart).toBe('1691-01-01');
    expect(after.dateEnd).toBeNull();

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        dateStart: '1691-01-01',
        dateEnd: '1691-01-01',
        dateQualifier: 'after',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_after'));
  });

  it('refuses any bound on an unknown date', async () => {
    const { scope, person } = await eventScope();

    // 'unknown' means "the source records no date"; a bound would be a date
    // the source never gave.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        dateStart: '1691-01-01',
        dateEnd: null,
        dateQualifier: 'unknown',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_unknown'));

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        dateStart: null,
        dateEnd: '1691-01-01',
        dateQualifier: 'unknown',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_unknown'));
  });

  it('requires both ordered bounds for a point date', async () => {
    const { scope, person } = await eventScope();

    // exact/about/estimated/calculated are closed intervals in the bounds
    // columns; precision carries "this is only known to the year". A missing
    // end would make `date_start <= date_end` unverifiable.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        dateStart: '1691-01-01',
        dateEnd: null,
        dateQualifier: 'exact',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_point'));

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        dateStart: '1691-12-31',
        dateEnd: '1691-01-01',
        dateQualifier: 'exact',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_point'));

    // `calculated` belongs to the point set too: a computed date is still a
    // point/interval, never a one-sided bound.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        dateStart: null,
        dateEnd: '1691-01-01',
        dateQualifier: 'calculated',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_point'));
  });

  it('requires both ordered bounds for a range', async () => {
    const { scope, person } = await eventScope();

    const period = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'occupation',
      eventKind: 'attribute',
      dateStart: '1691-01-01',
      dateEnd: '1695-12-31',
      dateQualifier: 'period',
    });
    expect(period.dateQualifier).toBe('period');

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        dateStart: '1695-12-31',
        dateEnd: '1691-01-01',
        dateQualifier: 'between',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_between'));

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        dateStart: '1695-12-31',
        dateEnd: null,
        dateQualifier: 'between',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_date_between'));
  });
});

describe('event age, type and kind', () => {
  it('requires age_years and age_basis to be set together', async () => {
    const { scope, person } = await eventScope();

    // Both directions: "73 years old, basis unknown" is not a fact anyone
    // recorded, and a basis with no number is a derivation with no result.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        ageYears: 73,
        ageBasis: null,
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_age_pair'));

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'death',
        ageYears: null,
        ageBasis: 'stated',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_age_pair'));

    const withAge = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'death',
      ageText: '享年七十有三',
      ageYears: 73,
      ageBasis: 'stated',
    });
    expect(withAge.ageYears).toBe(73);
    expect(withAge.ageText).toBe('享年七十有三');
  });

  it('requires custom_type when the type is custom', async () => {
    const { scope, person } = await eventScope();

    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'custom',
        customType: null,
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_custom_type'));

    // The rule keys off event_type only, never off event_kind, so a custom
    // *attribute* is written as `fact` + custom_type (GEDCOM 7's FACT + TYPE)
    // and a custom *event* as `custom` + custom_type (EVEN + TYPE).
    const customAttribute = await createEvent({
      ...scope,
      personId: person.id,
      eventKind: 'attribute',
      eventType: 'fact',
      customType: '捐官',
      value: '捐监生',
    });
    expect(customAttribute.eventKind).toBe('attribute');
    expect(customAttribute.customType).toBe('捐官');

    const customEvent = await createEvent({
      ...scope,
      personId: person.id,
      eventKind: 'event',
      eventType: 'custom',
      customType: '迁居',
    });
    expect(customEvent.eventType).toBe('custom');
  });

  it('refuses an event_type outside the closed value set', async () => {
    const { scope, person } = await eventScope();

    // `event_type` is an open enum in the sense that adding a value is a
    // migration, not that the database accepts anything: imports must fall back
    // to `other` rather than invent a tag.
    await expect(
      getTestSql()`
        insert into event
          (organization_id, project_id, person_id, event_type, created_by)
        values
          (${scope.orgId}, ${scope.projectId}, ${person.id}, 'not_a_real_event', ${scope.createdBy})`
    ).rejects.toSatisfy(isCheckViolation('ck_event_type'));
  });

  it('requires event_kind to agree with event_type', async () => {
    const { scope, person } = await eventScope();

    // `occupation` is an attribute type, so the column has to say so; the
    // database must not accept a row that contradicts its own type.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'occupation',
        eventKind: 'event',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_kind_matches_type'));

    // And the reverse: `birth` is not an attribute.
    await expect(
      createEvent({
        ...scope,
        personId: person.id,
        eventType: 'birth',
        eventKind: 'attribute',
      })
    ).rejects.toSatisfy(isCheckViolation('ck_event_kind_matches_type'));

    const occupation = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'occupation',
      eventKind: 'attribute',
      value: '塾师',
    });
    expect(occupation.eventKind).toBe('attribute');
  });
});

describe('event tenant isolation', () => {
  it('hides another organization’s events and refuses viewer writes', async () => {
    const mine = await eventScope();
    const theirs = await eventScope();
    await createEvent({ ...theirs.scope, personId: theirs.person.id });

    const visible = await withOrg(mine.user.id, (tx) =>
      tx.select().from(events)
    );
    expect(visible).toEqual([]);

    const viewer = await eventScope('viewer');
    await expect(
      withOrg(viewer.user.id, (tx) =>
        tx.insert(events).values({
          orgId: viewer.scope.orgId,
          projectId: viewer.scope.projectId,
          personId: viewer.person.id,
          createdBy: viewer.user.id,
          eventType: 'birth',
        })
      )
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');

    const editor = await eventScope('editor');
    const [inserted] = await withOrg(editor.user.id, (tx) =>
      tx
        .insert(events)
        .values({
          orgId: editor.scope.orgId,
          projectId: editor.scope.projectId,
          personId: editor.person.id,
          createdBy: editor.user.id,
          eventType: 'birth',
        })
        .returning()
    );
    expect(inserted?.orgId).toBe(editor.organization.id);
  });

  it('pins organization_id and project_id on event', async () => {
    const { user, organization, person, scope } = await eventScope();
    const other = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const event = await createEvent({ ...scope, personId: person.id });

    // Both halves of the RLS UPDATE policy are satisfied (the user owns both
    // projects), so only the trigger can refuse the move; assert its message so
    // an RLS rejection cannot be mistaken for it.
    await expect(
      withOrg(user.id, (tx) =>
        tx
          .update(events)
          .set({ projectId: other.id })
          .where(eq(events.id, event.id))
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes('column event.project_id is immutable')
        )
    );

    // A non-tenant column stays writable, otherwise the trigger would make the
    // table append-only.
    const [renamed] = await withOrg(user.id, (tx) =>
      tx
        .update(events)
        .set({ title: '改题' })
        .where(eq(events.id, event.id))
        .returning()
    );
    expect(renamed?.title).toBe('改题');
  });
});

// Every closed value set has a CHECK generated from the constant, so the two
// cannot drift: adding a value to lib/genealogy/constants.ts without a
// migration turns this red.
const enumConstraints = [
  { constraint: 'ck_event_type', values: EVENT_TYPE_VALUES },
  { constraint: 'ck_event_kind', values: EVENT_KIND_VALUES },
  // The equality also mentions the literal 'attribute' on its left half, which
  // is why that one is expected on top of the attribute type list.
  {
    constraint: 'ck_event_kind_matches_type',
    values: [...ATTRIBUTE_EVENT_TYPE_VALUES, 'attribute'],
  },
];

describe('event enum columns match the TypeScript constants', () => {
  for (const { constraint, values } of enumConstraints) {
    it(`event.${constraint}`, async () => {
      await expect(
        readCheckConstraintValues(getTestSql(), 'event', constraint)
      ).resolves.toEqual([...values].sort());
    });
  }
});

describe('event defaults', () => {
  it('stores the kind, qualifier and calendar defaults', async () => {
    const { scope, person } = await eventScope();
    const event = await createEvent({ ...scope, personId: person.id });

    // event_kind defaults to `event` and must still agree with the default
    // event_type; a caller that passes `occupation` has to pass `attribute`.
    expect(event.eventKind).toBe('event');
    expect(event.eventType).toBe('event');
    expect(event.dateQualifier).toBe('unknown');
    expect(event.calendar).toBe('gregorian');
    expect(event.dateCn).toBeNull();
  });

  it('round-trips the Chinese lunar date structure in date_cn', async () => {
    const { scope, person } = await eventScope();
    const dateCn = {
      era: 'kangxi',
      year: 38,
      month: 3,
      leap: false,
      day: 12,
      ganzhi: '己卯',
      shichen: '辰时',
      raw: '康熙三十八年三月十二日辰时',
    };

    const event = await createEvent({
      ...scope,
      personId: person.id,
      eventType: 'birth',
      dateOriginal: dateCn.raw,
      dateCn,
    });

    // Only the original structure is stored in P1: no lunar-to-Gregorian
    // conversion happens here, so date_start/date_end stay NULL.
    expect(event.dateCn).toEqual(dateCn);
    expect(event.dateStart).toBeNull();
  });
});
