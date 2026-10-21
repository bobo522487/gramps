import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import { generatePublicId } from '@/lib/ids';
import { db } from './drizzle';
import type { User } from './schema';
import {
  ActivityType,
  activityLogs,
  invitations,
  organizations,
  orgMembers,
  users,
} from './schema';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertOrganization(tx: Transaction, name: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const [organization] = await tx
      .insert(organizations)
      .values({ name, slug: generatePublicId() })
      .onConflictDoNothing({ target: organizations.slug })
      .returning();

    if (organization) {
      return organization;
    }
  }

  throw new Error('Failed to generate a unique organization slug');
}

export type RegisterAccountResult =
  | { ok: true; user: User }
  | { ok: false; reason: 'email_taken' | 'invalid_invitation' };

/**
 * Creates the account, its organization (or invited membership), the
 * invitation update and the initial activity rows in one transaction.
 * An invalid invitation leaves no user behind.
 */
export async function registerAccount(params: {
  email: string;
  passwordHash: string;
  inviteId?: string;
  ipAddress?: string;
}): Promise<RegisterAccountResult> {
  const { email, passwordHash, inviteId, ipAddress = '' } = params;

  return db.transaction(async (tx) => {
    let invitation: typeof invitations.$inferSelect | null = null;

    if (inviteId) {
      const id = Number(inviteId);
      if (!Number.isInteger(id) || id <= 0) {
        return { ok: false, reason: 'invalid_invitation' };
      }

      const [pending] = await tx
        .select()
        .from(invitations)
        .where(and(eq(invitations.id, id), eq(invitations.status, 'pending')))
        .for('update')
        .limit(1);

      if (!pending || pending.email.toLowerCase() !== email) {
        return { ok: false, reason: 'invalid_invitation' };
      }

      invitation = pending;
    }

    const [createdUser] = await tx
      .insert(users)
      .values({ email, passwordHash, role: 'member' })
      .onConflictDoNothing({ target: users.email })
      .returning();

    if (!createdUser) {
      return { ok: false, reason: 'email_taken' };
    }

    let orgId: number;
    let memberRole: string;

    if (invitation) {
      orgId = invitation.orgId;
      memberRole = invitation.role;

      await tx
        .update(invitations)
        .set({ status: 'accepted' })
        .where(
          and(
            eq(invitations.id, invitation.id),
            eq(invitations.status, 'pending')
          )
        );
    } else {
      const organization = await insertOrganization(
        tx,
        `${email.split('@')[0]} 的组织`
      );
      orgId = organization.id;
      memberRole = 'owner';
    }

    await tx
      .insert(orgMembers)
      .values({ userId: createdUser.id, orgId, role: memberRole });

    await tx.insert(activityLogs).values([
      {
        orgId: null,
        userId: createdUser.id,
        action: ActivityType.SIGN_UP,
        ipAddress,
      },
      {
        orgId,
        userId: createdUser.id,
        action: invitation
          ? ActivityType.ACCEPT_INVITATION
          : ActivityType.CREATE_ORG,
        ipAddress,
      },
    ]);

    return { ok: true, user: createdUser };
  });
}

export async function createOrganizationForOwner(params: {
  userId: number;
  name: string;
  ipAddress?: string;
}) {
  const { userId, name, ipAddress = '' } = params;

  return db.transaction(async (tx) => {
    const organization = await insertOrganization(tx, name);

    await tx
      .insert(orgMembers)
      .values({ userId, orgId: organization.id, role: 'owner' });

    await tx.insert(activityLogs).values({
      orgId: organization.id,
      userId,
      action: ActivityType.CREATE_ORG,
      ipAddress,
    });

    return organization;
  });
}

export type RemoveOrgMemberResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'org_not_found'
        | 'forbidden'
        | 'member_not_found'
        | 'self_removal'
        | 'last_owner';
    };

/** Locks the org so concurrent removals can't leave it without an owner. */
export async function removeOrgMemberInTransaction(params: {
  orgId: number;
  memberId: number;
  actorId: number;
  ipAddress?: string;
}): Promise<RemoveOrgMemberResult> {
  const { orgId, memberId, actorId, ipAddress = '' } = params;

  return db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for('update')
      .limit(1);

    if (!organization) {
      return { ok: false, reason: 'org_not_found' };
    }

    const [actor] = await tx
      .select({ role: orgMembers.role })
      .from(orgMembers)
      .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.userId, actorId)))
      .limit(1);

    if (actor?.role !== 'owner') {
      return { ok: false, reason: 'forbidden' };
    }

    const [target] = await tx
      .select({
        id: orgMembers.id,
        userId: orgMembers.userId,
        role: orgMembers.role,
      })
      .from(orgMembers)
      .where(and(eq(orgMembers.id, memberId), eq(orgMembers.orgId, orgId)))
      .limit(1);

    if (!target) {
      return { ok: false, reason: 'member_not_found' };
    }

    if (target.userId === actorId) {
      return { ok: false, reason: 'self_removal' };
    }

    if (target.role === 'owner') {
      const [ownerCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orgMembers)
        .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, 'owner')));

      if ((ownerCount?.count ?? 0) <= 1) {
        return { ok: false, reason: 'last_owner' };
      }
    }

    await tx.delete(orgMembers).where(eq(orgMembers.id, target.id));

    await tx.insert(activityLogs).values({
      orgId,
      userId: actorId,
      action: ActivityType.REMOVE_ORG_MEMBER,
      ipAddress,
    });

    return { ok: true };
  });
}

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; reason: 'sole_owner'; orgNames: string[] };

/**
 * Removes every membership the user has, revokes their sessions and
 * soft-deletes the account. Refuses when the user is the only owner of an
 * organization, because that would leave the org unmanageable.
 */
export async function deleteUserAccount(params: {
  userId: number;
  ipAddress?: string;
}): Promise<DeleteAccountResult> {
  const { userId, ipAddress = '' } = params;

  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .for('update')
      .limit(1);

    if (!account) {
      return { ok: true };
    }

    const ownedOrgs = await tx
      .select({ orgId: organizations.id, name: organizations.name })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, 'owner')))
      .orderBy(orgMembers.orgId);

    const soleOwnerOrgNames: string[] = [];

    for (const org of ownedOrgs) {
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, org.orgId))
        .for('update')
        .limit(1);

      const [ownerCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orgMembers)
        .where(
          and(eq(orgMembers.orgId, org.orgId), eq(orgMembers.role, 'owner'))
        );

      if ((ownerCount?.count ?? 0) <= 1) {
        soleOwnerOrgNames.push(org.name);
      }
    }

    if (soleOwnerOrgNames.length > 0) {
      return { ok: false, reason: 'sole_owner', orgNames: soleOwnerOrgNames };
    }

    await tx.delete(orgMembers).where(eq(orgMembers.userId, userId));

    await tx
      .update(users)
      .set({
        deletedAt: sql`CURRENT_TIMESTAMP`,
        // Keep the unique email usable for a future registration while
        // staying inside varchar(255).
        email: sql`left(${users.email}, 180) || '-' || ${users.id} || '-deleted'`,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(eq(users.id, userId));

    await tx.insert(activityLogs).values({
      orgId: null,
      userId,
      action: ActivityType.DELETE_ACCOUNT,
      ipAddress,
    });

    return { ok: true };
  });
}
