import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { withOrg } from '@/lib/db/drizzle';
import {
  families,
  familyChildren,
  familyPartners,
  projects,
} from '@/lib/db/schema';
import {
  PARENTAGE_TYPE_VALUES,
  PARTNER_ROLE_VALUES,
  PARTNER_STATUS_VALUES,
  UNION_TYPE_VALUES,
} from '@/lib/genealogy/constants';
import { readCheckConstraintValues } from '../helpers/constraints';
import {
  getTestDatabaseUrl,
  getTestDb,
  getTestSql,
  pgErrorCode,
  pgErrorMessages,
} from '../helpers/db';
import {
  addMember,
  createFamily,
  createFamilyChild,
  createFamilyPartner,
  createOrganization,
  createPerson,
  createProject,
  createUser,
} from '../helpers/factories';

// The family fact layer: the union itself, its partners (血亲/姻亲) and its
// children. Everything is asserted against a real database, because the rules
// this file exists for are database rules: the blood-side upper bound enforced
// by app.check_family_blood_side() (a trigger, not a CHECK — the "at most one"
// rule cannot be written declaratively), the composite foreign keys that keep a
// partner's person inside the same project, the partial uniqueness that makes a
// soft delete release a slot, and the tenant boundary (RLS + the immutability
// trigger) that keeps one organization's families out of another's.

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

function isBloodSideRejection(error: unknown) {
  return (
    pgErrorCode(error) === '23514' &&
    pgErrorMessages(error).some((message) =>
      message.includes('already has a blood partner')
    )
  );
}

describe('family, family_partner and family_child', () => {
  it('stores a family with a single blood partner (入赘/母系/母亲未知)', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const family = await createFamily({ ...scope, createdBy: user.id });
    const person = await createPerson({ ...scope, createdBy: user.id });

    const partner = await createFamilyPartner({
      ...scope,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
      role: 'blood',
    });

    // One blood partner is the normal case: the spouse may be unknown, the
    // husband may have married into the wife's family (入赘), or the union is
    // recorded from the mother's side only. Nothing may require a second one.
    expect(family.unionType).toBe('unknown');
    expect(partner.role).toBe('blood');
    expect(partner.partnerOrder).toBe(1);
    expect(partner.status).toBe('unknown');
  });

  it('refuses a second blood partner in the same family', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const family = await createFamily({ ...scope, createdBy: user.id });
    const husband = await createPerson({ ...scope, createdBy: user.id });
    const wife = await createPerson({ ...scope, createdBy: user.id });

    await createFamilyPartner({
      ...scope,
      familyId: family.id,
      personId: husband.id,
      createdBy: user.id,
      role: 'blood',
    });

    // 姻亲 goes in `role = 'spouse'`; a second 血亲 is not a representation the
    // fact layer accepts (the one exception is the project-level escape hatch
    // in the next case). This is the trigger, not a CHECK: "at most one" is a
    // cross-row rule.
    await expect(
      createFamilyPartner({
        ...scope,
        familyId: family.id,
        personId: wife.id,
        createdBy: user.id,
        role: 'blood',
      })
    ).rejects.toSatisfy(isBloodSideRejection);
  });

  it('allows a second blood partner when the project permits consanguineous marriage', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const family = await createFamily({ ...scope, createdBy: user.id });
    const first = await createPerson({ ...scope, createdBy: user.id });
    const second = await createPerson({ ...scope, createdBy: user.id });

    // 堂兄妹婚 exists in real genealogies; project.allow_consanguineous_marriage
    // is the per-project escape hatch, so the trigger must stand aside entirely.
    await getTestDb()
      .update(projects)
      .set({ allowConsanguineousMarriage: true })
      .where(eq(projects.id, project.id));

    await expect(
      createFamilyPartner({
        ...scope,
        familyId: family.id,
        personId: first.id,
        createdBy: user.id,
        role: 'blood',
      })
    ).resolves.toBeTruthy();
    await expect(
      createFamilyPartner({
        ...scope,
        familyId: family.id,
        personId: second.id,
        createdBy: user.id,
        role: 'blood',
      })
    ).resolves.toBeTruthy();
  });

  it('allows one partner row per person per family and frees the slot on soft delete', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const family = await createFamily({ ...scope, createdBy: user.id });
    const person = await createPerson({ ...scope, createdBy: user.id });

    // `spouse` keeps the blood-side trigger out of the way, so the rejection
    // here can only be uk_family_partner_family_person.
    const first = await createFamilyPartner({
      ...scope,
      familyId: family.id,
      personId: person.id,
      createdBy: user.id,
      role: 'spouse',
    });

    await expect(
      createFamilyPartner({
        ...scope,
        familyId: family.id,
        personId: person.id,
        createdBy: user.id,
        role: 'spouse',
      })
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '23505' &&
        pgErrorMessages(error).some((message) =>
          message.includes('uk_family_partner_family_person')
        )
    );

    // The index is partial on deleted_at IS NULL: dissolving a union is a soft
    // delete, and it must release the slot.
    await getTestDb()
      .update(familyPartners)
      .set({ deletedAt: new Date() })
      .where(eq(familyPartners.id, first.id));

    await expect(
      createFamilyPartner({
        ...scope,
        familyId: family.id,
        personId: person.id,
        createdBy: user.id,
        role: 'spouse',
      })
    ).resolves.toBeTruthy();
  });

  it('lets the same person be a child of two different families (兼祧/过继)', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const birthFamily = await createFamily({ ...scope, createdBy: user.id });
    const adoptiveFamily = await createFamily({ ...scope, createdBy: user.id });
    const person = await createPerson({ ...scope, createdBy: user.id });

    // 兼祧/过继 means one person is a child of DIFFERENT families — never twice
    // in the same one. The partial unique index is on (family, person), so the
    // second family is the supported shape.
    const birth = await createFamilyChild({
      ...scope,
      familyId: birthFamily.id,
      personId: person.id,
      createdBy: user.id,
    });
    expect(birth.parentageType).toBe('birth');
    expect(birth.isPrimary).toBe(true);

    await expect(
      createFamilyChild({
        ...scope,
        familyId: adoptiveFamily.id,
        personId: person.id,
        createdBy: user.id,
        parentageType: 'adoptive',
      })
    ).resolves.toBeTruthy();

    // Companion case: the same person twice in the SAME family is a duplicate.
    await expect(
      createFamilyChild({
        ...scope,
        familyId: birthFamily.id,
        personId: person.id,
        createdBy: user.id,
        parentageType: 'traditional',
      })
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '23505' &&
        pgErrorMessages(error).some((message) =>
          message.includes('uk_family_child_family_person')
        )
    );

    // A soft-deleted child row releases the slot, exactly like a partner row.
    await getTestDb()
      .update(familyChildren)
      .set({ deletedAt: new Date() })
      .where(eq(familyChildren.id, birth.id));

    await expect(
      createFamilyChild({
        ...scope,
        familyId: birthFamily.id,
        personId: person.id,
        createdBy: user.id,
        parentageType: 'traditional',
      })
    ).resolves.toBeTruthy();
  });

  it('refuses a partner whose person belongs to another project', async () => {
    const { user, organization, project } = await projectScope();
    const otherProject = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const family = await createFamily({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    // Same organization, different project: only the composite
    // (organization_id, project_id, person_id) key can refuse this.
    const foreignPerson = await createPerson({
      orgId: organization.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });

    await expect(
      createFamilyPartner({
        orgId: organization.id,
        projectId: project.id,
        familyId: family.id,
        personId: foreignPerson.id,
        createdBy: user.id,
        role: 'blood',
      })
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '23503' &&
        pgErrorMessages(error).some((message) =>
          message.includes('fk_family_partner_person')
        )
    );
  });

  it('serialises concurrent blood-partner inserts with an advisory lock', async () => {
    const { user, organization, project } = await projectScope();
    const scope = { orgId: organization.id, projectId: project.id };
    const family = await createFamily({ ...scope, createdBy: user.id });
    const firstPerson = await createPerson({ ...scope, createdBy: user.id });
    const secondPerson = await createPerson({ ...scope, createdBy: user.id });

    // Two real connections: the invariant has to hold across transactions, so
    // the trigger takes a transaction-scoped advisory lock keyed on the family.
    // Both clients bypass RLS (they log in as the test database owner), which
    // is what lets the test drive the lock directly.
    const insertBloodPartner = (
      client: ReturnType<typeof postgres>,
      personId: string
    ) => client`
      insert into family_partner
        (organization_id, project_id, family_id, person_id, created_by, role)
      values
        (${organization.id}, ${project.id}, ${family.id}, ${personId}, ${user.id}, 'blood')`;

    const first = postgres(getTestDatabaseUrl(), {
      max: 1,
      onnotice: () => {},
    });
    const second = postgres(getTestDatabaseUrl(), {
      max: 1,
      onnotice: () => {},
    });

    try {
      // Transaction 1 inserts a blood partner and holds the advisory lock
      // until it commits.
      await first.unsafe('begin');
      await insertBloodPartner(first, firstPerson.id);

      // Transaction 2 must block on that lock. A bounded statement_timeout
      // turns "blocks forever" into an assertion the suite can make: 57014
      // after the timeout proves it waited instead of racing through.
      await second.unsafe('begin');
      await second.unsafe("set local statement_timeout = '750ms'");
      const blockedAt = Date.now();
      const blockedOutcome = await insertBloodPartner(
        second,
        secondPerson.id
      ).then(
        () => null,
        (error: unknown) => error
      );
      const waited = Date.now() - blockedAt;

      expect(pgErrorCode(blockedOutcome)).toBe('57014');
      expect(waited).toBeGreaterThanOrEqual(500);
      await second.unsafe('rollback');

      // Once transaction 1 commits, the lock is free and the count sees its
      // row: the same insert now fails on the invariant, not on the timeout.
      await first.unsafe('commit');

      await second.unsafe('begin');
      const rejection = await insertBloodPartner(second, secondPerson.id).then(
        () => null,
        (error: unknown) => error
      );
      expect(isBloodSideRejection(rejection)).toBe(true);
      await second.unsafe('rollback');

      // Exactly one blood partner survived the race.
      const rows = await getTestSql()<{ count: number }[]>`
        select count(*)::int as count
        from family_partner
        where family_id = ${family.id}
          and role = 'blood'
          and deleted_at is null`;
      expect(rows[0]?.count).toBe(1);
    } finally {
      await first.end({ timeout: 5 });
      await second.end({ timeout: 5 });
    }
  });

  it('hides another organization’s families and refuses viewer writes', async () => {
    const mine = await projectScope();
    const theirs = await projectScope();
    await createFamily({
      orgId: theirs.organization.id,
      projectId: theirs.project.id,
      createdBy: theirs.user.id,
    });

    const visible = await withOrg(mine.user.id, (tx) =>
      tx.select().from(families)
    );
    expect(visible).toEqual([]);

    const viewer = await projectScope('viewer');
    const viewerFamily = await createFamily({
      orgId: viewer.organization.id,
      projectId: viewer.project.id,
      createdBy: viewer.user.id,
    });
    const viewerPerson = await createPerson({
      orgId: viewer.organization.id,
      projectId: viewer.project.id,
      createdBy: viewer.user.id,
    });

    await expect(
      withOrg(viewer.user.id, (tx) =>
        tx.insert(familyPartners).values({
          orgId: viewer.organization.id,
          projectId: viewer.project.id,
          familyId: viewerFamily.id,
          personId: viewerPerson.id,
          createdBy: viewer.user.id,
          role: 'blood',
        })
      )
    ).rejects.toSatisfy((error) => pgErrorCode(error) === '42501');

    const editor = await projectScope('editor');
    const editorFamily = await createFamily({
      orgId: editor.organization.id,
      projectId: editor.project.id,
      createdBy: editor.user.id,
    });
    const editorPerson = await createPerson({
      orgId: editor.organization.id,
      projectId: editor.project.id,
      createdBy: editor.user.id,
    });
    const [inserted] = await withOrg(editor.user.id, (tx) =>
      tx
        .insert(familyPartners)
        .values({
          orgId: editor.organization.id,
          projectId: editor.project.id,
          familyId: editorFamily.id,
          personId: editorPerson.id,
          createdBy: editor.user.id,
          role: 'blood',
        })
        .returning()
    );
    expect(inserted?.orgId).toBe(editor.organization.id);
  });

  it('pins organization_id and project_id on family', async () => {
    const { user, organization, project } = await projectScope();
    const other = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const family = await createFamily({
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
          .update(families)
          .set({ projectId: other.id })
          .where(eq(families.id, family.id))
      )
    ).rejects.toSatisfy(
      (error) =>
        pgErrorCode(error) === '42501' &&
        pgErrorMessages(error).some((message) =>
          message.includes('column family.project_id is immutable')
        )
    );
  });
});

// Every closed value set has a CHECK generated from the constant, so the two
// cannot drift: adding a value to lib/genealogy/constants.ts without a
// migration turns this red.
const enumConstraints = [
  {
    table: 'family',
    constraint: 'ck_family_union_type',
    values: UNION_TYPE_VALUES,
  },
  {
    table: 'family_partner',
    constraint: 'ck_family_partner_role',
    values: PARTNER_ROLE_VALUES,
  },
  {
    table: 'family_partner',
    constraint: 'ck_family_partner_status',
    values: PARTNER_STATUS_VALUES,
  },
  {
    table: 'family_child',
    constraint: 'ck_family_child_parentage_type',
    values: PARENTAGE_TYPE_VALUES,
  },
];

describe('family enum columns match the TypeScript constants', () => {
  for (const { table, constraint, values } of enumConstraints) {
    it(`${table}.${constraint}`, async () => {
      await expect(
        readCheckConstraintValues(getTestSql(), table, constraint)
      ).resolves.toEqual([...values].sort());
    });
  }
});
