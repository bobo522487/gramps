import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { hashInviteToken } from '@/lib/auth/invite-token';
import type { OrgRole } from '@/lib/auth/permissions';
import {
  invitations,
  type NewOrganization,
  type NewUser,
  organizations,
  orgMembers,
  projects,
  users,
} from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import { getTestDb } from './db';

export const TEST_PASSWORD = 'test-password-123';
const DEFAULT_PASSWORD_HASH = hashSync(TEST_PASSWORD, 4);

/**
 * Inserts directly into auth.users; the handle_new_user trigger creates the
 * personal organization and its owner membership in the same statement.
 */
export async function createUser(overrides: Partial<NewUser> = {}) {
  const [user] = await getTestDb()
    .insert(users)
    .values({
      email: `test-${randomUUID()}@example.com`,
      name: '测试用户',
      passwordHash: DEFAULT_PASSWORD_HASH,
      ...overrides,
    })
    .returning();
  return user;
}

/** The trigger-created personal organization (earliest owned membership). */
export async function getPersonalOrg(userId: string) {
  const [row] = await getTestDb()
    .select({ organization: organizations, membership: orgMembers })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
    .where(
      and(
        eq(orgMembers.userId, userId),
        eq(orgMembers.role, 'owner'),
        isNull(orgMembers.deletedAt)
      )
    )
    .orderBy(organizations.createdAt)
    .limit(1);
  return row ?? null;
}

export async function createOrganization(
  overrides: Partial<NewOrganization> = {}
) {
  const [organization] = await getTestDb()
    .insert(organizations)
    .values({
      name: '测试组织',
      slug: generatePublicId(),
      ...overrides,
    })
    .returning();
  return organization;
}

export async function addMember(params: {
  userId: string;
  orgId: string;
  role?: OrgRole;
  createdBy?: string;
}) {
  const [member] = await getTestDb()
    .insert(orgMembers)
    .values({ role: 'viewer', ...params })
    .returning();
  return member;
}

export async function createProject(params: {
  orgId: string;
  createdBy: string;
  name?: string;
  primaryName?: string;
  primarySurname?: string;
  hallCode?: string | null;
  countriesRegions?: string | null;
  ref?: string;
}) {
  const name = params.name ?? '测试云谱';
  const [project] = await getTestDb()
    .insert(projects)
    .values({
      orgId: params.orgId,
      createdBy: params.createdBy,
      name,
      primaryName: params.primaryName ?? name,
      primarySurname: params.primarySurname ?? '陈',
      hallCode: params.hallCode ?? null,
      countriesRegions: params.countriesRegions ?? null,
      ref: params.ref ?? generatePublicId(),
    })
    .returning();
  return project;
}

/** Returns the raw token alongside the row; only its hash is stored. */
export async function createInvitation(params: {
  orgId: string;
  invitedBy: string;
  email: string;
  role?: Exclude<OrgRole, 'owner'>;
  expiresAt?: Date;
  token?: string;
}) {
  const token = params.token ?? randomUUID().replaceAll('-', '');
  const [invitation] = await getTestDb()
    .insert(invitations)
    .values({
      orgId: params.orgId,
      email: params.email,
      role: params.role ?? 'viewer',
      tokenHash: hashInviteToken(token),
      expiresAt:
        params.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdBy: params.invitedBy,
    })
    .returning();
  return { ...invitation, token };
}
