import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/better-auth';
import type { OrgRole } from '@/lib/auth/permissions';
import {
  articles,
  bookCatalogs,
  books,
  families,
  familyChildren,
  familyPartners,
  folders,
  invitations,
  lineages,
  type NewOrganization,
  nodes,
  organizations,
  orgMembers,
  personNames,
  persons,
  projects,
} from '@/lib/db/schema';
import type {
  LivingStatus,
  NameStatus,
  ParentageType,
  PartnerRole,
  PartnerStatus,
  PersonNameType,
  PersonSex,
  PrivacyLevel,
  UnionType,
} from '@/lib/genealogy/constants';
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
  const path =
    role === 'spouse' ? null : (params.path ?? id.replaceAll('-', ''));
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

export async function createPerson(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  sex?: PersonSex;
  livingStatus?: LivingStatus;
  livingStatusLocked?: boolean;
  privacyLevel?: PrivacyLevel;
  nameStatus?: NameStatus;
  primaryNameId?: string | null;
  mergedIntoId?: string | null;
  sortKey?: string | null;
  legacyNodeId?: string | null;
}) {
  const [person] = await getTestDb()
    .insert(persons)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      sex: params.sex ?? 'male',
      livingStatus: params.livingStatus ?? 'unknown',
      livingStatusLocked: params.livingStatusLocked ?? false,
      privacyLevel: params.privacyLevel ?? 'private',
      nameStatus: params.nameStatus ?? 'known',
      primaryNameId: params.primaryNameId ?? null,
      mergedIntoId: params.mergedIntoId ?? null,
      sortKey: params.sortKey ?? null,
      legacyNodeId: params.legacyNodeId ?? null,
    })
    .returning();
  return person;
}

export async function createPersonName(params: {
  orgId: string;
  projectId: string;
  personId: string;
  createdBy: string;
  nameType?: PersonNameType;
  customType?: string | null;
  /** `null` is meaningful here: 名讳失考 has a name row with no full name. */
  fullName?: string | null;
  surname?: string | null;
  givenName?: string | null;
  namePrefix?: string | null;
  nameSuffix?: string | null;
  surnamePrefix?: string | null;
  nickname?: string | null;
  pinyin?: string | null;
  romanized?: string | null;
  language?: string | null;
  sortOrder?: number;
}) {
  const [name] = await getTestDb()
    .insert(personNames)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      personId: params.personId,
      createdBy: params.createdBy,
      nameType: params.nameType ?? 'birth',
      customType: params.customType ?? null,
      fullName: params.fullName === undefined ? '陈测试' : params.fullName,
      surname: params.surname === undefined ? '陈' : params.surname,
      givenName: params.givenName === undefined ? '测试' : params.givenName,
      namePrefix: params.namePrefix ?? null,
      nameSuffix: params.nameSuffix ?? null,
      surnamePrefix: params.surnamePrefix ?? null,
      nickname: params.nickname ?? null,
      pinyin: params.pinyin ?? null,
      romanized: params.romanized ?? null,
      language: params.language ?? null,
      sortOrder: params.sortOrder ?? 0,
    })
    .returning();
  return name;
}

export async function createFamily(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  unionType?: UnionType;
  sort?: number;
  notes?: string | null;
}) {
  const [family] = await getTestDb()
    .insert(families)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      createdBy: params.createdBy,
      unionType: params.unionType ?? 'unknown',
      sort: params.sort ?? 0,
      notes: params.notes ?? null,
    })
    .returning();
  return family;
}

export async function createFamilyPartner(params: {
  orgId: string;
  projectId: string;
  familyId: string;
  personId: string;
  createdBy: string;
  role?: PartnerRole;
  partnerOrder?: number;
  status?: PartnerStatus;
}) {
  const [partner] = await getTestDb()
    .insert(familyPartners)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      familyId: params.familyId,
      personId: params.personId,
      createdBy: params.createdBy,
      role: params.role ?? 'blood',
      partnerOrder: params.partnerOrder ?? 1,
      status: params.status ?? 'unknown',
    })
    .returning();
  return partner;
}

export async function createFamilyChild(params: {
  orgId: string;
  projectId: string;
  familyId: string;
  personId: string;
  createdBy: string;
  parentageType?: ParentageType;
  isPrimary?: boolean;
  sort?: number;
}) {
  const [child] = await getTestDb()
    .insert(familyChildren)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      familyId: params.familyId,
      personId: params.personId,
      createdBy: params.createdBy,
      parentageType: params.parentageType ?? 'birth',
      isPrimary: params.isPrimary ?? true,
      sort: params.sort ?? 0,
    })
    .returning();
  return child;
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
