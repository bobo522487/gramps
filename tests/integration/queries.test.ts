import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getActivityLogs, logActivity } from '@/lib/db/queries/activity';
import {
  countArticlesByFolder,
  getArticle,
  getArticleDeletePreview,
  getFolderDeletePreview,
  hasCatalogReference,
  listArticles,
} from '@/lib/db/queries/articles';
import { getFolders } from '@/lib/db/queries/folders';
import { getLineageById, getLineages } from '@/lib/db/queries/lineages';
import { getNodes } from '@/lib/db/queries/nodes';
import {
  getOrgById,
  getOrgsForUser,
  getOrgWithRoleBySlug,
} from '@/lib/db/queries/organizations';
import {
  countProjects,
  getProjectById,
  getProjectScopeByRef,
  getProjects,
} from '@/lib/db/queries/projects';
import {
  ActivityType,
  bookCatalogs,
  books,
  folders,
  lineages,
  nodes,
  organizations,
  projects,
} from '@/lib/db/schema';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createArticle,
  createBook,
  createCatalogItem,
  createFolder,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function personalOrgFor(userId: string) {
  const personal = await getPersonalOrg(userId);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  return personal.organization;
}

describe('folder queries', () => {
  it('filters by kind, orders by sort and hides soft-deleted rows', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const otherKind = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      sort: 0,
    });
    const later = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 2,
    });
    const earlier = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 1,
    });
    const deleted = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      sort: 0,
    });
    await getTestDb()
      .update(folders)
      .set({ deletedAt: new Date() })
      .where(eq(folders.id, deleted.id));

    const list = await getFolders(user.id, org.id, project.id, 0);

    expect(list.map((folder) => folder.id)).toEqual([earlier.id, later.id]);
    expect(list.map((folder) => folder.id)).not.toContain(otherKind.id);
    expect(list.map((folder) => folder.id)).not.toContain(deleted.id);

    // Isolation of the list itself (restored after the deleted single-row
    // helper took this coverage with it — see branch review I-1).
    const otherOrg = await createOrganization();
    expect(await getFolders(user.id, otherOrg.id, project.id, 0)).toEqual([]);

    const stranger = await createUser();
    expect(await getFolders(stranger.id, org.id, project.id, 0)).toEqual([]);
  });
});

describe('node queries', () => {
  it('lists a lineage, hides soft-deleted rows and stays org-scoped', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const lineage = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const root = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
    });
    const child = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 2,
      parentId: root.id,
    });
    const deleted = await createNode({
      orgId: org.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
    });
    await getTestDb()
      .update(nodes)
      .set({ deletedAt: new Date() })
      .where(eq(nodes.id, deleted.id));

    const list = await getNodes(user.id, org.id, lineage.id);
    expect(list.map((node) => node.id)).toEqual([root.id, child.id]);
    expect(list.map((node) => node.id)).not.toContain(deleted.id);

    // Foreign org id: the app-level orgId filter returns nothing…
    const otherOrg = await createOrganization();
    expect(await getNodes(user.id, otherOrg.id, lineage.id)).toEqual([]);
    // …and a non-member gets nothing even when passing the right orgId (RLS).
    const stranger = await createUser();
    expect(await getNodes(stranger.id, org.id, lineage.id)).toEqual([]);
  });
});

describe('lineage queries', () => {
  it('scopes lists to the project and hides soft-deleted lineages', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    const otherProject = await createProject({
      orgId: org.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      name: '颍川陈氏',
    });
    const deleted = await createLineage({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const foreign = await createLineage({
      orgId: org.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });
    await getTestDb()
      .update(lineages)
      .set({ deletedAt: new Date() })
      .where(eq(lineages.id, deleted.id));

    const list = await getLineages(user.id, org.id, project.id);

    expect(list.map((row) => row.id)).toEqual([lineage.id]);
    expect(list.map((row) => row.id)).not.toContain(foreign.id);

    expect(await getLineageById(user.id, org.id, lineage.id)).toMatchObject({
      name: '颍川陈氏',
    });
    expect(await getLineageById(user.id, org.id, deleted.id)).toBeNull();

    const stranger = await createUser();
    expect(await getLineageById(stranger.id, org.id, lineage.id)).toBeNull();
  });
});

describe('organization queries', () => {
  it('reads memberships and hides archived organizations', async () => {
    const owner = await createUser();
    const org = await personalOrgFor(owner.id);
    const member = await createUser();
    await addMember({
      userId: member.id,
      organizationId: org.id,
      role: 'editor',
    });

    expect(await getOrgById(owner.id, org.id)).toMatchObject({ id: org.id });
    expect(await getOrgById(member.id, org.id)).toMatchObject({ id: org.id });
    expect(
      await getOrgById(member.id, '00000000-0000-7000-8000-000000000000')
    ).toBeNull();

    const stranger = await createUser();
    expect(await getOrgById(stranger.id, org.id)).toBeNull();

    const listed = await getOrgsForUser(member.id);
    expect(listed.map((row) => row.organization.id)).toContain(org.id);
    expect(listed.find((row) => row.organization.id === org.id)?.role).toBe(
      'editor'
    );

    expect(await getOrgWithRoleBySlug(owner.id, org.slug)).toMatchObject({
      role: 'owner',
    });
    expect(await getOrgWithRoleBySlug(stranger.id, org.slug)).toBeNull();

    await getTestDb()
      .update(organizations)
      .set({ status: 'closed', deletedAt: new Date() })
      .where(eq(organizations.id, org.id));
    expect(await getOrgById(owner.id, org.id)).toBeNull();
    expect(await getOrgWithRoleBySlug(owner.id, org.slug)).toBeNull();
    expect(await getOrgsForUser(owner.id)).toEqual([]);
  });
});

describe('project queries', () => {
  it('lists, counts and scopes projects by org', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const otherOrg = await createOrganization();
    const first = await createProject({
      orgId: org.id,
      createdBy: user.id,
      name: '甲谱',
    });
    const second = await createProject({
      orgId: org.id,
      createdBy: user.id,
      name: '乙谱',
    });
    const foreign = await createProject({
      orgId: otherOrg.id,
      createdBy: user.id,
    });

    const list = await getProjects(user.id, org.id);
    expect(list.map((row) => row.id).sort()).toEqual(
      [first.id, second.id].sort()
    );
    expect(await countProjects(user.id, org.id)).toBe(2);

    expect(await getProjectById(user.id, first.id, org.id)).toMatchObject({
      name: '甲谱',
    });
    expect(await getProjectById(user.id, foreign.id, org.id)).toBeNull();

    const scope = await getProjectScopeByRef(user.id, second.ref);
    expect(scope?.project.id).toBe(second.id);
    expect(scope?.role).toBe('owner');

    await getTestDb()
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, first.id));
    expect(await getProjectById(user.id, first.id, org.id)).toBeNull();
    expect(await countProjects(user.id, org.id)).toBe(1);
  });
});

describe('activity queries', () => {
  it('appends account-level events and returns the ten most recent', async () => {
    const user = await createUser();
    const org = await personalOrgFor(user.id);

    await logActivity(user.id, null, ActivityType.SIGN_IN, '127.0.0.1');
    for (let index = 0; index < 11; index += 1) {
      await logActivity(user.id, org.id, ActivityType.UPDATE_NODE);
    }

    const logs = await getActivityLogs(user.id);
    expect(logs).toHaveLength(10);
    expect(logs[0].action).toBe(ActivityType.UPDATE_NODE);

    const other = await createUser();
    expect(await getActivityLogs(other.id)).toEqual([]);
  });
});

/**
 * 谱文查询层。页数与图片数都从
 * `article.content` 的分页文档包现算，不占列；分类篇数只认 `folder.kind = 1`
 * （`article.kind` 恒为 NULL），未分类 = 总数 − 各分类之和。
 */
describe('article queries', () => {
  async function setup() {
    const user = await createUser();
    const org = await personalOrgFor(user.id);
    const project = await createProject({ orgId: org.id, createdBy: user.id });
    return { user, org, project };
  }

  function articleDoc(pageCount: number, imagesPerPage: number[] = []) {
    return {
      schemaVersion: 1,
      pages: Array.from({ length: pageCount }, (_, index) => ({
        id: `page-${index}`,
        doc: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `第 ${index + 1} 页正文` }],
            },
            ...Array.from(
              { length: imagesPerPage[index] ?? 0 },
              (_, imageIndex) => ({
                type: 'articleImage',
                attrs: {
                  pathname: `articles/placeholder/placeholder/img-${imageIndex}.png`,
                  width: 'full',
                },
              })
            ),
          ],
        },
      })),
    };
  }

  it('lists articles newest-first with page counts derived from the document', async () => {
    const { user, org, project } = await setup();
    const legacy = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '旧数据',
      content: { type: 'doc', content: [] },
    });
    const edited = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '改过',
      content: articleDoc(3),
      updatedAt: new Date(Date.now() + 3_600_000),
    });
    const untouched = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '没改过',
      content: articleDoc(1),
    });

    const list = await listArticles(user.id, org.id, project.id);

    expect(list.map((item) => item.id)).toEqual([
      edited.id,
      untouched.id,
      legacy.id,
    ]);
    const counts = new Map(list.map((item) => [item.id, item.pageCount]));
    expect(counts.get(edited.id)).toBe(3);
    // 旧的单文档形状兜底成一页，列表不会显示 0 页
    expect(counts.get(legacy.id)).toBe(1);
  });

  it('hides soft-deleted articles and foreign organizations', async () => {
    const { user, org, project } = await setup();
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      deletedAt: new Date(),
    });
    const outsider = await createUser();

    const list = await listArticles(user.id, org.id, project.id);
    expect(list).toHaveLength(0);
    // 外人带正确的 orgId 也拿不到（RLS + orgId 双条件）
    expect(await listArticles(outsider.id, org.id, project.id)).toHaveLength(0);
  });

  it('counts articles per 谱文 folder and derives the unfiled count', async () => {
    const { user, org, project } = await setup();
    const orderFolder = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      name: '谱序',
    });
    const bioFolder = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      name: '传记',
    });
    const lineageFolder = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
      name: '谱系分类',
    });

    for (const title of ['谱序一', '谱序二']) {
      await createArticle({
        orgId: org.id,
        projectId: project.id,
        createdBy: user.id,
        title,
        folderId: orderFolder.id,
      });
    }
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '传记一',
      folderId: bioFolder.id,
    });
    // 挂在谱系分类下的脏数据不参与分类篇数，计入未分类
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '挂错分类',
      folderId: lineageFolder.id,
    });
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '没分类',
    });
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '已删除',
      folderId: orderFolder.id,
      deletedAt: new Date(),
    });

    const counts = await countArticlesByFolder(user.id, org.id, project.id);

    expect(counts.byFolder.get(orderFolder.id)).toBe(2);
    expect(counts.byFolder.get(bioFolder.id)).toBe(1);
    expect(counts.byFolder.has(lineageFolder.id)).toBe(false);
    // 5 篇活动谱文：3 篇在谱文分类里，1 篇没分类、1 篇挂错种类 → 都算未分类
    expect(counts.total).toBe(5);
    expect(counts.unfiled).toBe(2);
  });

  it('previews an article delete with its page and image counts', async () => {
    const { user, org, project } = await setup();
    const article = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      title: '像赞',
      content: articleDoc(2, [3, 1]),
    });

    const preview = await getArticleDeletePreview(user.id, org.id, article.id);

    expect(preview).toMatchObject({
      title: '像赞',
      pageCount: 2,
      imageCount: 4,
    });
    expect(
      await getArticleDeletePreview(user.id, org.id, crypto.randomUUID())
    ).toBeNull();
  });

  it('returns the full document for one article', async () => {
    const { user, org, project } = await setup();
    const content = articleDoc(2, [1]);
    const article = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      content,
    });

    const loaded = await getArticle(user.id, org.id, article.id);

    expect(loaded?.title).toBe(article.title);
    expect(loaded?.content).toEqual(content);
    expect(await getArticle(user.id, org.id, crypto.randomUUID())).toBeNull();
  });

  it('treats only active catalog references as blocking', async () => {
    const { user, org, project } = await setup();
    const article = await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const book = await createBook({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const item = await createCatalogItem({
      orgId: org.id,
      bookId: book.id,
      createdBy: user.id,
      articleId: article.id,
    });

    expect(await hasCatalogReference(user.id, org.id, article.id)).toBe(true);

    await getTestDb()
      .update(bookCatalogs)
      .set({ deletedAt: new Date() })
      .where(eq(bookCatalogs.id, item.id));
    expect(await hasCatalogReference(user.id, org.id, article.id)).toBe(false);

    await getTestDb()
      .update(bookCatalogs)
      .set({ deletedAt: null })
      .where(eq(bookCatalogs.id, item.id));
    await getTestDb()
      .update(books)
      .set({ deletedAt: new Date() })
      .where(eq(books.id, book.id));
    expect(await hasCatalogReference(user.id, org.id, article.id)).toBe(false);
  });

  it('previews a folder delete with its subtree and article counts', async () => {
    const { user, org, project } = await setup();
    const parent = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      name: '谱序',
    });
    const child = await createFolder({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
      parentId: parent.id,
      name: '修谱序',
    });
    await createArticle({
      orgId: org.id,
      projectId: project.id,
      createdBy: user.id,
      folderId: parent.id,
    });
    for (const title of ['甲', '乙']) {
      await createArticle({
        orgId: org.id,
        projectId: project.id,
        createdBy: user.id,
        title,
        folderId: child.id,
      });
    }

    const preview = await getFolderDeletePreview(user.id, org.id, parent.id);

    expect(preview).toMatchObject({
      name: '谱序',
      folderCount: 2,
      articleCount: 3,
    });
    expect(
      await getFolderDeletePreview(user.id, org.id, crypto.randomUUID())
    ).toBeNull();
  });
});
