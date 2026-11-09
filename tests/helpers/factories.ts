import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  type ArticleContent,
  createEmptyArticleContent,
  serializeArticleContent,
} from '@/lib/article/doc';
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
  /** 历史参数：目标态 `book` 不再有 `created_by` 列，接受但忽略。 */
  createdBy?: string;
  name?: string;
  folderId?: string | null;
}) {
  // 目标态 `book` 只有 `title`（附录 A.5），没有 `name` / `surname` / `created_by`
  // 等旧列；`name` 参数承载的语义就是书名，直接落到 `title`。
  const title = params.name ?? '测试谱书';
  const [book] = await getTestDb()
    .insert(books)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      folderId: params.folderId ?? null,
      title,
    })
    .returning();
  return book;
}

export async function createArticle(params: {
  orgId: string;
  projectId: string;
  /** 历史参数：目标态 `article` 不再有 `created_by` 列，接受但忽略。 */
  createdBy?: string;
  title?: string;
  folderId?: string | null;
  content?: ArticleContent;
}) {
  const title = params.title ?? '测试谱文';
  const [article] = await getTestDb()
    .insert(articles)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      folderId: params.folderId ?? null,
      title,
      body: serializeArticleContent(
        params.content ?? createEmptyArticleContent()
      ),
    })
    .returning();
  return article;
}

/**
 * 删一篇谱文。目标态 `article` 没有 `deleted_at`（附录 A.5），业务删除就是
 * 真删，所以这里也只是删行——名字沿用 `softDelete*` 会让后来人以为还有软删。
 */
export async function deleteArticle(articleId: string): Promise<void> {
  await getTestDb().delete(articles).where(eq(articles.id, articleId));
}

/**
 * 目标态 `book_catalog`（附录 A.5）：主键 (project_id, id)，层级用 `path ltree`
 * 表达，没有 created_by / section / sort / 软删列。
 *
 * `path` 默认 `0001`（满足 path_format 且 nlevel=1，parent_path 生成列为 NULL，
 * 自引用 `book_catalog_parent_fk` 不生效，无需先建父行）。同书同路径会撞
 * `book_catalog_path_unique`，需要多级 / 兄弟节点时显式传 `path`，并保证父段
 * 已存在（父路径 FK 是 RESTRICT）。
 */
export async function createCatalogItem(params: {
  orgId: string;
  projectId: string;
  bookId: string;
  path?: string;
  title?: string;
  articleId?: string | null;
  lineageId?: string | null;
}) {
  const [item] = await getTestDb()
    .insert(bookCatalogs)
    .values({
      orgId: params.orgId,
      projectId: params.projectId,
      bookId: params.bookId,
      path: params.path ?? '0001',
      title: params.title ?? '测试编目',
      lineageId: params.lineageId ?? null,
      articleId: params.articleId ?? null,
    })
    .returning();
  return item;
}
/**
 * 造一封邀请。
 *
 * `token` 是**明文**，只在返回值里出现一次——库里存的是它的 sha256
 * （附录 A.1）。测试要调 `app.accept_invite` 时必须拿这个明文，所以工厂
 * 把它一并返回，而不是让调用方自己哈希一遍（那样两边口径漂移时测试仍然绿）。
 *
 * `status` 只剩基线 CHECK 的三个值：'rejected' / 'canceled' 是 Better Auth
 * 插件的取值，自建 token 之后没有人会写它们。
 */
export async function createInvitation(params: {
  organizationId: string;
  invitedBy?: string;
  email: string;
  role?: Exclude<OrgRole, 'owner'>;
  expiresAt?: Date;
  status?: 'pending' | 'accepted' | 'revoked';
}) {
  const plaintext = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256')
    .update(plaintext, 'utf8')
    .digest('hex');
  const status = params.status ?? 'pending';
  const [invitation] = await getTestDb()
    .insert(invitations)
    .values({
      organizationId: params.organizationId,
      // 基线 CHECK 要求 `email = lower(email)`。大小写归一是**写入路径**的
      // 责任（`issueInvitation()` 里 trim + toLowerCase），测试直插时也得照做，
      // 否则测出来的是「CHECK 拦住了大写邮箱」而不是被测的那条规则。
      email: params.email.trim().toLowerCase(),
      role: params.role ?? 'viewer',
      status,
      tokenHash,
      expiresAt:
        params.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      // 基线 CHECK 是 `expires_at > created_at`。只把 expiresAt 设在过去
      // 造不出「过期邀请」——created_at 默认 now()，于是 expires_at 在它之前，
      // 直接撞 23514。过期邀请的正确造法是「过去创建、早已到期」：
      // created_at 显式回填到更早，两个时间点一起前移。
      ...(params.expiresAt
        ? {
            createdAt: new Date(
              Math.min(
                params.expiresAt.getTime(),
                Date.now() - 24 * 60 * 60 * 1000
              )
            ),
          }
        : {}),
      // 两条单向蕴含：accepted 必须有时刻，有时刻的只能是 accepted / revoked。
      acceptedAt: status === 'pending' ? null : new Date(),
      invitedBy: params.invitedBy ?? null,
    })
    .returning();
  return { ...invitation, token: plaintext };
}
