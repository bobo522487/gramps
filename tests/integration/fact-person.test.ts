import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import { personNames, persons } from '@/lib/db/schema';
import {
  LIVING_STATUS_VALUES,
  NAME_STATUS_VALUES,
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
  PRIVACY_LEVEL_VALUES,
} from '@/lib/genealogy/constants';
import { readCheckConstraintValues } from '../helpers/constraints';
import {
  getTestDb,
  getTestSql,
  pgErrorCode,
  pgErrorMessages,
} from '../helpers/db';
import {
  addMember,
  createOrganization,
  createPerson,
  createPersonName,
  createProject,
  createUser,
} from '../helpers/factories';

// The fact layer's first two tables. Everything here is asserted against a real
// database: the CHECK/FK/uniqueness rules the backfill (Task 7) and the
// reconciliation (Task 8) rely on, the tenant boundary that keeps one
// organization's people out of another's, and the enum<->CHECK invariant that
// stops lib/genealogy/constants.ts and the DDL from drifting apart.

/** Owner/editor/viewer of a fresh organization plus one project in it. */
async function projectScope(role: 'owner' | 'editor' | 'viewer' = 'owner') {
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
  return { user, organization, project };
}

describe('person and person_name', () => {
  it('stores a person whose name is lost: no full name, name_status unknown, no primary name', async () => {
    const { user, organization, project } = await projectScope();

    // 名讳失考: the person exists, but nothing about the name is recorded. The
    // row must be insertable without inventing a placeholder name, and the
    // name row must be allowed to carry a NULL full_name.
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      nameStatus: 'unknown',
    });
    const name = await createPersonName({
      orgId: organization.id,
      projectId: project.id,
      personId: person.id,
      createdBy: user.id,
      fullName: null,
    });

    expect(person.nameStatus).toBe('unknown');
    expect(person.primaryNameId).toBeNull();
    expect(name.fullName).toBeNull();
  });

  it('requires a custom_type when name_type is other', async () => {
    const { user, organization, project } = await projectScope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    await expect(
      createPersonName({
        orgId: organization.id,
        projectId: project.id,
        personId: person.id,
        createdBy: user.id,
        nameType: 'other',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');

    // The same row with a custom_type is the supported shape.
    await expect(
      createPersonName({
        orgId: organization.id,
        projectId: project.id,
        personId: person.id,
        createdBy: user.id,
        nameType: 'other',
        customType: '谱名',
      })
    ).resolves.toBeTruthy();
  });

  it('allows one name per (person, name_type, sort_order) and frees it on soft delete', async () => {
    const { user, organization, project } = await projectScope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    const first = await createPersonName({
      orgId: organization.id,
      projectId: project.id,
      personId: person.id,
      createdBy: user.id,
      nameType: 'courtesy',
      sortOrder: 0,
      fullName: '陈元英',
    });

    await expect(
      createPersonName({
        orgId: organization.id,
        projectId: project.id,
        personId: person.id,
        createdBy: user.id,
        nameType: 'courtesy',
        sortOrder: 0,
        fullName: '陈元英',
      })
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23505');

    // uk_person_name_type_order is partial on deleted_at IS NULL, so a
    // soft-deleted name no longer reserves the slot.
    await getTestDb()
      .update(personNames)
      .set({ deletedAt: new Date() })
      .where(eq(personNames.id, first.id));

    await expect(
      createPersonName({
        orgId: organization.id,
        projectId: project.id,
        personId: person.id,
        createdBy: user.id,
        nameType: 'courtesy',
        sortOrder: 0,
        fullName: '陈元英',
      })
    ).resolves.toBeTruthy();
  });

  it('refuses a primary_name_id that belongs to another person', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const alice = await createPerson({ ...scope, createdBy: user.id });
    const bob = await createPerson({ ...scope, createdBy: user.id });
    const bobName = await createPersonName({
      ...scope,
      personId: bob.id,
      createdBy: user.id,
      fullName: '陈仲',
    });
    const aliceName = await createPersonName({
      ...scope,
      personId: alice.id,
      createdBy: user.id,
      fullName: '陈伯',
    });

    // fk_person_primary_name is the composite
    // (organization_id, id, primary_name_id) -> person_name(organization_id,
    // person_id, id), so the name has to belong to the same person.
    await expect(
      getTestDb()
        .update(persons)
        .set({ primaryNameId: bobName.id })
        .where(eq(persons.id, alice.id))
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23503');

    await expect(
      getTestDb()
        .update(persons)
        .set({ primaryNameId: aliceName.id })
        .where(eq(persons.id, alice.id))
    ).resolves.toBeTruthy();
  });

  it('refuses a person merged into itself', async () => {
    const { user, organization, project } = await projectScope();
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    await expect(
      getTestDb()
        .update(persons)
        .set({ mergedIntoId: person.id })
        .where(eq(persons.id, person.id))
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '23514');
  });

  it('hides another organization’s people and refuses viewer writes', async () => {
    const mine = await projectScope();
    const theirs = await projectScope();
    await createPerson({
      orgId: theirs.organization.id,
      projectId: theirs.project.id,
      createdBy: theirs.user.id,
    });

    const visible = await withOrg(mine.user.id, (tx) =>
      tx.select().from(persons)
    );
    expect(visible).toEqual([]);

    const viewer = await projectScope('viewer');
    await expect(
      withOrg(viewer.user.id, (tx) =>
        tx.insert(persons).values({
          orgId: viewer.organization.id,
          projectId: viewer.project.id,
          createdBy: viewer.user.id,
          sex: 'male',
          livingStatus: 'unknown',
          privacyLevel: 'private',
          nameStatus: 'known',
        })
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes(
            'new row violates row-level security policy for table "person"'
          )
        )
    );

    const editor = await projectScope('editor');
    const [inserted] = await withOrg(editor.user.id, (tx) =>
      tx
        .insert(persons)
        .values({
          orgId: editor.organization.id,
          projectId: editor.project.id,
          createdBy: editor.user.id,
          sex: 'female',
          livingStatus: 'living',
          privacyLevel: 'restricted',
          nameStatus: 'known',
        })
        .returning()
    );
    expect(inserted?.orgId).toBe(editor.organization.id);
  });

  it('applies the person_name policies per role', async () => {
    const mine = await projectScope();
    const theirs = await projectScope();
    const theirPerson = await createPerson({
      orgId: theirs.organization.id,
      projectId: theirs.project.id,
      createdBy: theirs.user.id,
    });
    await createPersonName({
      orgId: theirs.organization.id,
      projectId: theirs.project.id,
      personId: theirPerson.id,
      createdBy: theirs.user.id,
    });

    const visible = await withOrg(mine.user.id, (tx) =>
      tx.select().from(personNames)
    );
    expect(visible).toEqual([]);

    const viewer = await projectScope('viewer');
    const viewerPerson = await createPerson({
      orgId: viewer.organization.id,
      projectId: viewer.project.id,
      createdBy: viewer.user.id,
    });
    // 42501 alone would also be raised by a revoked INSERT grant; the message
    // pins the rejection to the policy, which is what this test is about.
    await expect(
      withOrg(viewer.user.id, (tx) =>
        tx.insert(personNames).values({
          orgId: viewer.organization.id,
          projectId: viewer.project.id,
          personId: viewerPerson.id,
          createdBy: viewer.user.id,
          nameType: 'birth',
          fullName: '陈拒绝',
        })
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes(
            'new row violates row-level security policy for table "person_name"'
          )
        )
    );

    const editor = await projectScope('editor');
    const editorPerson = await createPerson({
      orgId: editor.organization.id,
      projectId: editor.project.id,
      createdBy: editor.user.id,
    });
    const [inserted] = await withOrg(editor.user.id, (tx) =>
      tx
        .insert(personNames)
        .values({
          orgId: editor.organization.id,
          projectId: editor.project.id,
          personId: editorPerson.id,
          createdBy: editor.user.id,
          nameType: 'birth',
          fullName: '陈允许',
        })
        .returning()
    );
    expect(inserted?.personId).toBe(editorPerson.id);
    if (!inserted) throw new Error('editor insert returned no row');

    // The UPDATE policy's USING clause filters rows instead of raising, so a
    // viewer's update is a silent zero-row no-op, not a 42501.
    const updated = await withOrg(viewer.user.id, (tx) =>
      tx
        .update(personNames)
        .set({ fullName: '陈篡改' })
        .where(eq(personNames.id, inserted.id))
        .returning()
    );
    expect(updated).toEqual([]);

    const [unchanged] = await getTestDb()
      .select()
      .from(personNames)
      .where(eq(personNames.id, inserted.id));
    expect(unchanged?.fullName).toBe('陈允许');
  });

  it('pins organization_id and project_id on person', async () => {
    const { user, organization, project } = await projectScope();
    const other = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const person = await createPerson({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    // Both halves of the RLS UPDATE policy are satisfied (the user owns both
    // projects), so only the trigger can refuse the move; assert its message so
    // an RLS rejection cannot be mistaken for it.
    await expect(
      withOrg(user.id, (tx) =>
        tx
          .update(persons)
          .set({ projectId: other.id })
          .where(eq(persons.id, person.id))
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes('column person.project_id is immutable')
        )
    );
  });
});

// Every closed value set has a CHECK generated from the constant, so the two
// cannot drift: adding a value to lib/genealogy/constants.ts without a
// migration turns this red.
const enumConstraints = [
  { table: 'person', constraint: 'ck_person_sex', values: PERSON_SEX_VALUES },
  {
    table: 'person',
    constraint: 'ck_person_living_status',
    values: LIVING_STATUS_VALUES,
  },
  {
    table: 'person',
    constraint: 'ck_person_privacy_level',
    values: PRIVACY_LEVEL_VALUES,
  },
  {
    table: 'person',
    constraint: 'ck_person_name_status',
    values: NAME_STATUS_VALUES,
  },
  {
    table: 'person_name',
    constraint: 'ck_person_name_type',
    values: PERSON_NAME_TYPE_VALUES,
  },
];

describe('person enum columns match the TypeScript constants', () => {
  for (const { table, constraint, values } of enumConstraints) {
    it(`${table}.${constraint}`, async () => {
      await expect(
        readCheckConstraintValues(getTestSql(), table, constraint)
      ).resolves.toEqual([...values].sort());
    });
  }
});
