import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/better-auth';
import type { OrgRole } from '@/lib/auth/permissions';
import {
  articles,
  bookCatalogs,
  books,
  events,
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
import type { PersonSex } from '@/lib/genealogy/constants';
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

/**
 * Target-model `lineage` (appendix A.4) only carries scope + display columns.
 * `createdBy` / `surname` / `generationWords` remain accepted for backwards
 * compatibility with the callers that still pass them, but are no longer
 * columns and are deliberately not written.
 */
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
      folderId: params.folderId ?? null,
      name: params.name ?? '测试谱系',
    })
    .returning();
  return lineage;
}

/**
 * A target-model `node` is a tree position, not a person. `projectId` (part of
 * the composite key) and `personId` are therefore explicit; the old identity
 * columns (role / generation / sort / name / sex / soft delete / requestId)
 * are accepted for caller compatibility but are no longer written.
 */
export async function createNode(params: {
  orgId: string;
  lineageId: string;
  createdBy: string;
  projectId?: string;
  personId?: string | null;
  kind?: 'primary' | 'repeat' | 'annotation';
  parentId?: string | null;
  spouseOfId?: string | null;
  role?: 'blood' | 'spouse';
  path?: string | null;
  generation?: number;
  sort?: number;
  name?: string;
  surname?: string;
  sex?: number;
  courtesy?: string | null;
  isAlive?: boolean;
  birthText?: string | null;
  birthYear?: number | null;
  deathText?: string | null;
  deathYear?: number | null;
  burialPlace?: string | null;
  fullName?: string | null;
  deletedAt?: Date | null;
  requestId?: string | null;
}) {
  const id = randomUUID();
  // `(project_id, id)` is the key: callers that omit projectId must still get
  // the scope from their lineage, otherwise the scope FK rejects the row.
  const projectId =
    params.projectId ??
    (
      await getTestDb()
        .select({ projectId: lineages.projectId })
        .from(lineages)
        .where(eq(lineages.id, params.lineageId))
        .limit(1)
    )[0]?.projectId ??
    '';
  const [node] = await getTestDb()
    .insert(nodes)
    .values({
      id,
      orgId: params.orgId,
      projectId,
      lineageId: params.lineageId,
      personId: params.personId ?? null,
      path: params.path ?? '0001',
      kind: params.kind ?? 'annotation',
      displayName: params.name ?? '测试人丁',
    })
    .returning();
  return node;
}

/**
 * Target-model `person` is just an identity plus `sex`; the retired snapshot
 * columns are accepted but not written.
 */
export async function createPerson(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  sex?: PersonSex;
  livingStatus?: string;
  livingStatusLocked?: boolean;
  privacyLevel?: string;
  nameStatus?: string;
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
      sex: params.sex ?? 'male',
    })
    .returning();
  return person;
}

/**
 * Target-model `person_name` records `(kind, value)`; the retired
 * fullName/surname/givenName split is accepted but not written.
 */
export async function createPersonName(params: {
  orgId: string;
  projectId: string;
  personId: string;
  createdBy: string;
  nameType?: string;
  customType?: string | null;
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
      kind: 'given',
      value: params.fullName ?? '陈测试',
      isPrimary: true,
    })
    .returning();
  return name;
}

/** Target-model `family` is a bare join row. */
export async function createFamily(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  unionType?: string;
  sort?: number;
  notes?: string | null;
}) {
  const [family] = await getTestDb()
    .insert(families)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
    })
    .returning();
  return family;
}

/** Target-model `family_partner` uses `role` / `rank`, not status/order. */
export async function createFamilyPartner(params: {
  orgId: string;
  projectId: string;
  familyId: string;
  personId: string;
  createdBy: string;
  role?: string;
  partnerOrder?: number;
  status?: string;
}) {
  const [partner] = await getTestDb()
    .insert(familyPartners)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      familyId: params.familyId,
      personId: params.personId,
      role: 'husband',
      rank: 1,
    })
    .returning();
  return partner;
}

/** Target-model `family_child` uses `kind` and optional mother/origin keys. */
export async function createFamilyChild(params: {
  orgId: string;
  projectId: string;
  familyId: string;
  personId: string;
  createdBy: string;
  parentageType?: string;
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
      kind: 'biological',
    })
    .returning();
  return child;
}

/**
 * Target-model `event` is a single flat domain with one subject. The retired
 * date/age/title columns are accepted but not written; `kind` defaults to a
 * person birth so the factory only ever produces a structurally valid row
 * when the caller supplies a `personId`.
 */
export async function createEvent(params: {
  orgId: string;
  projectId: string;
  createdBy: string;
  personId?: string | null;
  familyId?: string | null;
  eventKind?: string;
  eventType?: string;
  customType?: string | null;
  gedcomTag?: string | null;
  title?: string | null;
  value?: string | null;
  description?: string | null;
  dateOriginal?: string | null;
  dateStart?: string | null;
  dateEnd?: string | null;
  datePrecision?: string | null;
  dateQualifier?: string;
  calendar?: string;
  dateCn?: Record<string, unknown> | null;
  ageText?: string | null;
  ageYears?: number | null;
  ageBasis?: string | null;
  placeOriginal?: string | null;
}) {
  const [event] = await getTestDb()
    .insert(events)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      kind: 'birth',
      personId: params.personId ?? null,
      familyId: params.familyId ?? null,
    })
    .returning();
  return event;
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
  folderId?: string | null;
  content?: Record<string, unknown>;
  plainText?: string;
  updatedAt?: Date;
  deletedAt?: Date;
}) {
  const title = params.title ?? '测试谱文';
  const [article] = await getTestDb()
    .insert(articles)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      folderId: params.folderId ?? null,
      createdBy: params.createdBy,
      title,
      content: params.content ?? { type: 'doc', content: [] },
      plainText: params.plainText ?? title,
      updatedAt: params.updatedAt,
      deletedAt: params.deletedAt,
    })
    .returning();
  return article;
}

/** 软删一篇谱文（业务删除就是这个形状：只写 `deleted_at`）。 */
export async function softDeleteArticle(articleId: string): Promise<void> {
  await getTestDb()
    .update(articles)
    .set({ deletedAt: new Date() })
    .where(eq(articles.id, articleId));
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
