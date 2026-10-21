import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import { and, eq, isNull } from 'drizzle-orm';
import { hashInviteToken } from '@/lib/auth/invite-token';
import type { OrgRole } from '@/lib/auth/permissions';
import {
  articles,
  bookCatalogs,
  books,
  folders,
  invitations,
  lineages,
  type NewOrganization,
  type NewUser,
  nodes,
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

export async function createFolder(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  kind?: number;
  parentId?: string | null;
  name?: string;
  sort?: number;
}) {
  const [folder] = await getTestDb()
    .insert(folders)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      kind: params.kind ?? 0,
      parentId: params.parentId ?? null,
      name: params.name ?? '测试分类',
      sort: params.sort ?? 0,
    })
    .returning();
  return folder;
}

export async function createLineage(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  folderId?: string | null;
  name?: string;
  surname?: string;
  generationWords?: string[] | null;
}) {
  const [lineage] = await getTestDb()
    .insert(lineages)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      folderId: params.folderId ?? null,
      name: params.name ?? '测试谱系',
      surname: params.surname ?? '陈',
      generationWords: params.generationWords ?? null,
    })
    .returning();
  return lineage;
}

export async function createNode(params: {
  orgId: string;
  lineageId: string;
  createdBy: string;
  parentId?: string | null;
  spouseOfId?: string | null;
  role?: 'blood' | 'spouse';
  path?: string | null;
  depth?: number;
  generation: number;
  sort?: number;
  name?: string;
  surname?: string;
  sex?: number;
}) {
  const id = randomUUID();
  const role = params.role ?? 'blood';
  const [node] = await getTestDb()
    .insert(nodes)
    .values({
      id,
      orgId: params.orgId,
      lineageId: params.lineageId,
      createdBy: params.createdBy,
      parentId: params.parentId ?? null,
      spouseOfId: params.spouseOfId ?? null,
      role,
      path: role === 'spouse' ? null : (params.path ?? id.replaceAll('-', '')),
      depth: params.depth ?? 0,
      generation: params.generation,
      sort: params.sort ?? 0,
      name: params.name ?? '测试人丁',
      surname: params.surname ?? '陈',
      fullName: `${params.surname ?? '陈'}${params.name ?? '测试人丁'}`,
      sex: params.sex ?? 0,
    })
    .returning();
  return node;
}

export async function createBook(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  name?: string;
}) {
  const name = params.name ?? '测试谱书';
  const [book] = await getTestDb()
    .insert(books)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      name,
      title: name,
      surname: '陈',
    })
    .returning();
  return book;
}

export async function createArticle(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  title?: string;
}) {
  const [article] = await getTestDb()
    .insert(articles)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      title: params.title ?? '测试谱文',
      content: { type: 'doc', content: [] },
      plainText: '测试谱文',
    })
    .returning();
  return article;
}

export async function createCatalogItem(params: {
  orgId: string;
  bookId: string;
  createdBy: string;
  lineageId?: string | null;
  articleId?: string | null;
  name?: string;
}) {
  const [item] = await getTestDb()
    .insert(bookCatalogs)
    .values({
      orgId: params.orgId,
      bookId: params.bookId,
      createdBy: params.createdBy,
      lineageId: params.lineageId ?? null,
      articleId: params.articleId ?? null,
      name: params.name ?? '测试编目',
      section: 2,
    })
    .returning();
  return item;
}
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
