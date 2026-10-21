import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
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

export async function createUser(overrides: Partial<NewUser> = {}) {
  const [user] = await getTestDb()
    .insert(users)
    .values({
      email: `test-${randomUUID()}@example.com`,
      name: '测试用户',
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: 'member',
      ...overrides,
    })
    .returning();
  return user;
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
  userId: number;
  orgId: number;
  role?: string;
}) {
  const [member] = await getTestDb()
    .insert(orgMembers)
    .values({ role: 'member', ...params })
    .returning();
  return member;
}

export async function createProject(params: {
  orgId: number;
  name?: string;
  slug?: string;
  ref?: string;
}) {
  const suffix = randomUUID().slice(0, 8);
  const [project] = await getTestDb()
    .insert(projects)
    .values({
      orgId: params.orgId,
      name: params.name ?? '测试项目',
      slug: params.slug ?? `project-${suffix}`,
      ref: params.ref ?? generatePublicId(),
    })
    .returning();
  return project;
}

export async function createInvitation(params: {
  orgId: number;
  invitedBy: number;
  email?: string;
  role?: string;
}) {
  const [invitation] = await getTestDb()
    .insert(invitations)
    .values({
      orgId: params.orgId,
      invitedBy: params.invitedBy,
      email: params.email ?? `invite-${randomUUID()}@example.com`,
      role: params.role ?? 'member',
    })
    .returning();
  return invitation;
}
