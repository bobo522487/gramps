import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/better-auth';
import type { OrgRole } from '@/lib/auth/permissions';
import {
  articles,
  bookCatalogs,
  books,
  folders,
  invitations,
  lineages,
  type NewOrganization,
  nodes,
  organizations,
  orgMembers,
  projects,
} from '@/lib/db/schema';
import { generatePublicId } from '@/lib/ids';
import { getTestDb } from './db';

export const TEST_PASSWORD = 'test-password-123';

/**
 * Registers through Better Auth so the auth triggers, password hashing and
 * handle_new_user personal-organization creation all run for real.
 */
export async function createUser(
  overrides: Partial<{ email: string; name: string; password: string }> = {}
) {
  const email = overrides.email ?? `test-${randomUUID()}@example.com`;
  const result = await getAuth().api.signUpEmail({
    body: {
      email,
      name: overrides.name ?? '测试用户',
      password: overrides.password ?? TEST_PASSWORD,
    },
  });
  return result.user;
}

/** The trigger-created personal organization (earliest owned membership). */
export async function getPersonalOrg(userId: string) {
  const [row] = await getTestDb()
    .select({ organization: organizations, membership: orgMembers })
    .from(orgMembers)
    .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
    .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, 'owner')))
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
  organizationId: string;
  role?: OrgRole;
}) {
  const [member] = await getTestDb()
    .insert(orgMembers)
    .values({
      userId: params.userId,
      organizationId: params.organizationId,
      role: params.role ?? 'viewer',
    })
    .returning();
  return member;
}

export async function createProject(params: {
  orgId: string;
  createdBy: string;
  name?: string;
  themeName?: string;
  surname?: string;
  hallCode?: string | null;
  countriesRegions?: string | null;
  ref?: string;
}) {
  const name = params.name ?? '测试云谱';
  const themeName = params.themeName ?? `${name}主题`;
  const surname = params.surname ?? '陈';
  const [project] = await getTestDb()
    .insert(projects)
    .values({
      orgId: params.orgId,
      createdBy: params.createdBy,
      name,
      themeName,
      surname,
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
  // ck_node_depth_eq_level pins depth to the path; writers that pass an
  // explicit inconsistent depth still hit the constraint (deliberate:
  // tests/integration/constraints.test.ts proves the database rejects it).
  const path = role === 'spouse' ? null : (params.path ?? id.replaceAll('-', ''));
  const derivedDepth = path === null ? 0 : path.split('.').length - 1;
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
      path,
      depth: params.depth ?? derivedDepth,
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
  organizationId: string;
  inviterId: string;
  email: string;
  role?: Exclude<OrgRole, 'owner'>;
  expiresAt?: Date;
  status?: 'pending' | 'accepted' | 'rejected' | 'canceled';
}) {
  const [invitation] = await getTestDb()
    .insert(invitations)
    .values({
      organizationId: params.organizationId,
      email: params.email,
      role: params.role ?? 'viewer',
      status: params.status ?? 'pending',
      expiresAt:
        params.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      inviterId: params.inviterId,
    })
    .returning();
  return invitation;
}
