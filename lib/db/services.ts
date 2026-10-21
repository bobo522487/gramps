import 'server-only';

import { and, eq, isNull, lte, sql } from 'drizzle-orm';
import { createInviteToken, hashInviteToken } from '@/lib/auth/invite-token';
import {
  getOrgRoleInTx,
  hasPermission,
  type OrgRole,
} from '@/lib/auth/permissions';
import { generatePublicId } from '@/lib/ids';
import { type DbTransaction, db, queryRows, withOrg } from './drizzle';
import { isRaisedException, isUniqueViolation } from './errors';
import { logActivityInTx } from './queries/activity';
import { findPendingInvitationInTx } from './queries/invitations';
import {
  ActivityType,
  invitations,
  organizations,
  orgMembers,
  type Project,
  projects,
} from './schema';

export type RegisterAccountResult =
  | {
      ok: true;
      user: {
        id: string;
        email: string;
        name: string | null;
        tokenVersion: number;
        defaultOrganizationId: string;
      };
    }
  | { ok: false; reason: 'email_taken' | 'invalid_invitation' };

/**
 * One SQL function call: user row, default org, invited membership and the
 * activity rows commit or roll back together, so a bad invite leaves no user.
 */
export async function registerAccount(params: {
  email: string;
  name: string;
  passwordHash: string;
  inviteToken?: string;
  ipAddress?: string;
}): Promise<RegisterAccountResult> {
  const { email, name, passwordHash, inviteToken, ipAddress } = params;
  const tokenHash = inviteToken ? hashInviteToken(inviteToken) : null;

  try {
    const rows = await queryRows<{
      id: string;
      email: string;
      name: string | null;
      tokenVersion: number;
      defaultOrganizationId: string;
    }>(
      db,
      sql`
        select id, email, name,
               token_version as "tokenVersion",
               default_organization_id as "defaultOrganizationId"
        from auth.sign_up(${email}, ${name}, ${passwordHash}, ${tokenHash}, ${ipAddress ?? null})
      `
    );

    const user = rows[0];
    if (!user) {
      return { ok: false, reason: 'invalid_invitation' };
    }
    return { ok: true, user };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'email_taken' };
    }
    if (isRaisedException(error, 'invalid_invitation')) {
      return { ok: false, reason: 'invalid_invitation' };
    }
    throw error;
  }
}

export async function createOrganizationForOwner(params: {
  userId: string;
  name: string;
  ipAddress?: string;
}) {
  const { userId, name, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const rows = await queryRows<{ id: string; slug: string; name: string }>(
      tx,
      sql`select * from auth.create_organization(${name})`
    );
    const organization = rows[0];
    if (!organization) {
      return null;
    }

    await logActivityInTx(
      tx,
      userId,
      organization.id,
      ActivityType.CREATE_ORG,
      ipAddress
    );
    return organization;
  });
}

type OrgMutationFailure = 'not_found' | 'forbidden';

export async function renameOrganization(params: {
  userId: string;
  orgId: string;
  name: string;
  ipAddress?: string;
}): Promise<
  { ok: true; slug: string } | { ok: false; reason: OrgMutationFailure }
> {
  const { userId, orgId, name, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'org.settings')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [organization] = await tx
      .update(organizations)
      .set({ name })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning();

    if (!organization) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.RENAME_ORG,
      ipAddress
    );
    return { ok: true, slug: organization.slug };
  });
}

export async function archiveOrganization(params: {
  userId: string;
  orgId: string;
  ipAddress?: string;
}): Promise<{ ok: true } | { ok: false; reason: OrgMutationFailure }> {
  const { userId, orgId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'org.settings')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [organization] = await tx
      .update(organizations)
      .set({ status: 'closed', deletedAt: new Date() })
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .returning();

    if (!organization) {
      return { ok: false, reason: 'not_found' as const };
    }

    // Pending links must stop working as soon as the org is closed.
    await tx
      .update(invitations)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(invitations.orgId, orgId),
          isNull(invitations.acceptedAt),
          isNull(invitations.deletedAt)
        )
      );

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.ARCHIVE_ORG,
      ipAddress
    );
    return { ok: true };
  });
}

export type InviteMemberResult =
  | { ok: true; inviteUrl: string; expiresAt: Date }
  | {
      ok: false;
      reason:
        | 'forbidden'
        | 'org_not_found'
        | 'already_member'
        | 'pending_exists';
    };

export async function inviteOrgMember(params: {
  userId: string;
  orgId: string;
  email: string;
  role: Exclude<OrgRole, 'owner'>;
  ipAddress?: string;
}): Promise<InviteMemberResult> {
  const { userId, orgId, email, role, ipAddress } = params;
  const { token, tokenHash } = createInviteToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    return await withOrg(userId, async (tx) => {
      const actorRole = await getOrgRoleInTx(tx, userId, orgId);
      if (!actorRole || !hasPermission(actorRole, 'member.invite')) {
        return { ok: false, reason: 'forbidden' as const };
      }

      const [organization] = await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(
          and(eq(organizations.id, orgId), isNull(organizations.deletedAt))
        )
        .limit(1);
      if (!organization) {
        return { ok: false, reason: 'org_not_found' as const };
      }

      const alreadyMember = await queryRows<{ found: boolean }>(
        tx,
        sql`select auth.is_user_in_org_by_email(${email}, ${orgId}::uuid) as found`
      );
      if (alreadyMember[0]?.found) {
        return { ok: false, reason: 'already_member' as const };
      }

      if (await findPendingInvitationInTx(tx, email, orgId)) {
        return { ok: false, reason: 'pending_exists' as const };
      }

      // Expired invites no longer block a new one: the partial unique index
      // does not look at expires_at, so retire them first.
      await tx
        .update(invitations)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(invitations.orgId, orgId),
            sql`lower(${invitations.email}) = ${email}`,
            isNull(invitations.acceptedAt),
            isNull(invitations.deletedAt),
            lte(invitations.expiresAt, new Date())
          )
        );

      await tx.insert(invitations).values({
        orgId,
        email,
        role,
        tokenHash,
        expiresAt,
        createdBy: userId,
      });

      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.INVITE_ORG_MEMBER,
        ipAddress
      );

      return {
        ok: true as const,
        inviteUrl: `/sign-up?invite=${token}`,
        expiresAt,
      };
    });
  } catch (error) {
    // The partial unique index is the concurrency guard; the pre-check above
    // only exists to avoid a failed statement in the common case.
    if (isUniqueViolation(error)) {
      return { ok: false, reason: 'pending_exists' };
    }
    throw error;
  }
}

export type AcceptInviteResult =
  | { ok: true; organizationId: string; role: OrgRole }
  | { ok: false; reason: 'forbidden' | 'invalid_invitation' };

export async function acceptInvite(params: {
  userId: string;
  token: string;
  ipAddress?: string;
}): Promise<AcceptInviteResult> {
  const { userId, token, ipAddress } = params;

  try {
    return await withOrg(userId, async (tx) => {
      const rows = await queryRows<{ organizationId: string; role: string }>(
        tx,
        sql`
          select organization_id as "organizationId", role
          from auth.accept_invite(${hashInviteToken(token)}, ${ipAddress ?? null})
        `
      );
      const invite = rows[0];
      if (
        !invite ||
        (invite.role !== 'admin' &&
          invite.role !== 'editor' &&
          invite.role !== 'viewer')
      ) {
        return { ok: false, reason: 'invalid_invitation' as const };
      }
      return {
        ok: true as const,
        organizationId: invite.organizationId,
        role: invite.role,
      };
    });
  } catch (error) {
    if (isRaisedException(error, 'invalid_invitation')) {
      return { ok: false, reason: 'invalid_invitation' };
    }
    if (isRaisedException(error, 'forbidden')) {
      return { ok: false, reason: 'forbidden' };
    }
    throw error;
  }
}

export type RemoveOrgMemberResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'forbidden' | 'member_not_found' | 'self_removal' | 'last_owner';
    };

/** Locks active members so concurrent removals can't leave the org ownerless. */
export async function removeOrgMemberInTransaction(params: {
  orgId: string;
  memberId: string;
  actorId: string;
  ipAddress?: string;
}): Promise<RemoveOrgMemberResult> {
  const { orgId, memberId, actorId, ipAddress } = params;

  return withOrg(actorId, async (tx) => {
    const actorRole = await getOrgRoleInTx(tx, actorId, orgId);
    if (!actorRole || !hasPermission(actorRole, 'member.manage')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const members = await lockActiveMembers(tx, orgId);
    const target = members.find((member) => member.id === memberId);
    if (!target) {
      return { ok: false, reason: 'member_not_found' as const };
    }
    if (target.userId === actorId) {
      return { ok: false, reason: 'self_removal' as const };
    }
    if (target.role === 'owner') {
      if (actorRole !== 'owner') {
        return { ok: false, reason: 'forbidden' as const };
      }
      const ownerCount = members.filter(
        (member) => member.role === 'owner'
      ).length;
      if (ownerCount <= 1) {
        return { ok: false, reason: 'last_owner' as const };
      }
    } else if (actorRole === 'admin' && target.role === 'admin') {
      // Only the owner manages admins.
      return { ok: false, reason: 'forbidden' as const };
    }

    await tx
      .update(orgMembers)
      .set({ deletedAt: new Date() })
      .where(eq(orgMembers.id, target.id));

    await logActivityInTx(
      tx,
      actorId,
      orgId,
      ActivityType.REMOVE_ORG_MEMBER,
      ipAddress
    );
    return { ok: true as const };
  });
}

export type UpdateMemberRoleResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'forbidden'
        | 'member_not_found'
        | 'owner_immutable'
        | 'same_role';
    };

export async function updateOrgMemberRoleInTransaction(params: {
  orgId: string;
  memberId: string;
  role: Exclude<OrgRole, 'owner'>;
  actorId: string;
  ipAddress?: string;
}): Promise<UpdateMemberRoleResult> {
  const { orgId, memberId, role, actorId, ipAddress } = params;

  return withOrg(actorId, async (tx) => {
    const actorRole = await getOrgRoleInTx(tx, actorId, orgId);
    if (!actorRole || !hasPermission(actorRole, 'member.manage')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const members = await lockActiveMembers(tx, orgId);
    const target = members.find((member) => member.id === memberId);
    if (!target) {
      return { ok: false, reason: 'member_not_found' as const };
    }
    if (target.role === 'owner') {
      return { ok: false, reason: 'owner_immutable' as const };
    }
    // Admins manage editors/viewers; only the owner manages admins.
    if (
      actorRole === 'admin' &&
      (target.role === 'admin' || role === 'admin')
    ) {
      return { ok: false, reason: 'forbidden' as const };
    }
    if (target.role === role) {
      return { ok: false, reason: 'same_role' as const };
    }

    await tx
      .update(orgMembers)
      .set({ role })
      .where(eq(orgMembers.id, target.id));

    await logActivityInTx(
      tx,
      actorId,
      orgId,
      ActivityType.UPDATE_MEMBER_ROLE,
      ipAddress
    );
    return { ok: true as const };
  });
}

type LockedMember = { id: string; userId: string; role: string };

async function lockActiveMembers(
  tx: DbTransaction,
  orgId: string
): Promise<LockedMember[]> {
  return tx
    .select({
      id: orgMembers.id,
      userId: orgMembers.userId,
      role: orgMembers.role,
    })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), isNull(orgMembers.deletedAt)))
    .for('update');
}

export type ProjectInput = {
  name: string;
  primaryName: string;
  primarySurname: string;
  hallCode?: string | null;
  countriesRegions?: string | null;
};

export type ProjectUpdates = Partial<ProjectInput>;

export type ProjectMutationResult =
  | { ok: true; project: Project }
  | { ok: false; reason: 'forbidden' | 'not_found' | 'conflict' };

export async function createProjectInTransaction(params: {
  userId: string;
  orgId: string;
  input: ProjectInput;
  ipAddress?: string;
}): Promise<ProjectMutationResult> {
  const { userId, orgId, input, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), isNull(organizations.deletedAt)))
      .limit(1);
    if (!organization) {
      return { ok: false, reason: 'not_found' as const };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // A fresh ref on every attempt: reusing a colliding one would loop.
      const [project] = await tx
        .insert(projects)
        .values({
          ...input,
          orgId,
          ref: generatePublicId(),
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning();

      if (project) {
        await logActivityInTx(
          tx,
          userId,
          orgId,
          ActivityType.CREATE_PROJECT,
          ipAddress
        );
        return { ok: true as const, project };
      }
    }

    return { ok: false, reason: 'conflict' as const };
  });
}

export async function updateProjectInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  updates: ProjectUpdates;
  ipAddress?: string;
}): Promise<ProjectMutationResult> {
  const { userId, orgId, projectId, updates, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const [project] = await tx
      .update(projects)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt)
        )
      )
      .returning();

    if (!project) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.UPDATE_PROJECT,
      ipAddress
    );
    return { ok: true as const, project };
  });
}

export async function deleteProjectInTransaction(params: {
  userId: string;
  orgId: string;
  projectId: string;
  ipAddress?: string;
}): Promise<{ ok: true } | { ok: false; reason: 'forbidden' | 'not_found' }> {
  const { userId, orgId, projectId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const role = await getOrgRoleInTx(tx, userId, orgId);
    if (!role || !hasPermission(role, 'project.write')) {
      return { ok: false, reason: 'forbidden' as const };
    }

    const rows = await tx
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.orgId, orgId),
          isNull(projects.deletedAt)
        )
      )
      .returning({ id: projects.id });

    if (rows.length === 0) {
      return { ok: false, reason: 'not_found' as const };
    }

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.DELETE_PROJECT,
      ipAddress
    );
    return { ok: true as const };
  });
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: 'sole_owner'; orgNames: string[] };

/**
 * Removes every membership the user has, revokes sessions and soft-deletes
 * the account. Refuses when the user is the only owner of an organization.
 */
export async function deleteUserAccount(params: {
  userId: string;
  ipAddress?: string;
}): Promise<DeleteAccountResult> {
  const { userId, ipAddress } = params;

  return withOrg(userId, async (tx) => {
    const owned = await tx
      .select({ orgId: orgMembers.orgId })
      .from(orgMembers)
      .where(
        and(
          eq(orgMembers.userId, userId),
          eq(orgMembers.role, 'owner'),
          isNull(orgMembers.deletedAt)
        )
      )
      .for('update');

    const soleOwnerOrgNames: string[] = [];

    for (const { orgId } of owned) {
      // Lock the org row and its owner rows: a concurrent transfer/removal
      // cannot change the count between the check and the delete.
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(
          and(eq(organizations.id, orgId), isNull(organizations.deletedAt))
        )
        .for('update')
        .limit(1);

      // Archived organizations no longer block account deletion.
      if (!organization) {
        continue;
      }

      const owners = await tx
        .select({ id: orgMembers.id })
        .from(orgMembers)
        .where(
          and(
            eq(orgMembers.orgId, orgId),
            eq(orgMembers.role, 'owner'),
            isNull(orgMembers.deletedAt)
          )
        )
        .for('update');

      if (owners.length <= 1 && organization) {
        soleOwnerOrgNames.push(organization.name);
      }
    }

    if (soleOwnerOrgNames.length > 0) {
      return {
        ok: false,
        reason: 'sole_owner' as const,
        orgNames: soleOwnerOrgNames,
      };
    }

    await logActivityInTx(
      tx,
      userId,
      null,
      ActivityType.DELETE_ACCOUNT,
      ipAddress
    );
    await queryRows(tx, sql`select auth.soft_delete_user()`);
    return { ok: true as const };
  });
}
