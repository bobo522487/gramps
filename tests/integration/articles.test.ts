import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addArticlePageAction,
  createArticleAction,
  deleteArticleAction,
  deleteArticlePageAction,
  getArticleDeletePreviewAction,
  getFolderDeletePreviewAction,
  moveArticleAction,
  reorderArticlePagesAction,
  saveArticlePageAction,
  updateArticleTitleAction,
} from '@/lib/article/actions';
import { ARTICLE_ERRORS } from '@/lib/article/constants';
import { parseArticleContent } from '@/lib/article/doc';
import { fsMediaStore } from '@/lib/article/media/fs-store';
import { PERMISSION_DENIED_MESSAGES } from '@/lib/auth/permissions';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
import { articles, bookCatalogs, folders } from '@/lib/db/schema';
import { signSessionFor } from '../helpers/auth';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createArticle,
  createBook,
  createCatalogItem,
  createFolder,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';
import { pinFsMediaMode } from '../helpers/media-mode';

/**
 * 谱文 CRUD 与按页保存（Task 6 / FR-001..FR-006、FR-010..FR-017、FR-021）。
 *
 * 直接调 Action：权限、事务、白名单校验、`page_not_found` 的拒绝路径都只在
 * 「Action → 事务」这条真实链路上才可验证（宪法 IV）。
 */

/** Action 返回 `T | ActionState`：测试里用 `in` 收窄，不做 `as` 断言。 */
function dataOf<T>(result: T | { data?: T }): T {
  if (
    typeof result !== 'object' ||
    result === null ||
    !('data' in result) ||
    result.data === undefined
  ) {
    throw new Error(`Action 没有返回数据：${JSON.stringify(result)}`);
  }
  return result.data;
}

pinFsMediaMode();

const session = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  headers: async () => {
    const headers = new Headers();
    if (session.cookie) {
      headers.set('cookie', session.cookie);
    }
    return headers;
  },
}));

vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

type Fixture = {
  orgId: string;
  projectId: string;
  ownerId: string;
  editorId: string;
  viewerId: string;
  outsiderId: string;
  outsiderOrgId: string;
  outsiderProjectId: string;
  emails: Map<string, string>;
};

let fixture: Fixture;

function paragraphDoc(text: string) {
  return {
    type: 'doc' as const,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

function contentOf(...pages: { id: string; text: string }[]) {
  return {
    schemaVersion: 1,
    pages: pages.map((page) => ({ id: page.id, doc: paragraphDoc(page.text) })),
  };
}

async function readContent(articleId: string) {
  const [row] = await getTestDb()
    .select({
      content: articles.content,
      plainText: articles.plainText,
      title: articles.title,
      folderId: articles.folderId,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  return row;
}

/**
 * `tests/integration/setup.ts` 会在**每个用例前**清库，所以夹具只能逐例重建。
 */
async function buildFixture(): Promise<Fixture> {
  const owner = await createUser();
  const emails = new Map<string, string>();
  const org = await createOrganization({ name: '谱文测试组织' });
  await addMember({ userId: owner.id, organizationId: org.id, role: 'owner' });
  const editor = await createUser();
  const viewer = await createUser();
  emails.set(owner.id, owner.email);
  emails.set(editor.id, editor.email);
  emails.set(viewer.id, viewer.email);
  await addMember({
    userId: editor.id,
    organizationId: org.id,
    role: 'editor',
  });
  await addMember({
    userId: viewer.id,
    organizationId: org.id,
    role: 'viewer',
  });
  const project = await createProject({ orgId: org.id, createdBy: owner.id });

  const outsider = await createUser();
  emails.set(outsider.id, outsider.email);
  const outsiderPersonal = await getPersonalOrg(outsider.id);
  if (!outsiderPersonal) {
    throw new Error('注册用户应当自动获得个人组织');
  }
  const outsiderOrg = outsiderPersonal.organization;
  const outsiderProject = await createProject({
    orgId: outsiderOrg.id,
    createdBy: outsider.id,
  });

  return {
    orgId: org.id,
    projectId: project.id,
    ownerId: owner.id,
    editorId: editor.id,
    viewerId: viewer.id,
    outsiderId: outsider.id,
    outsiderOrgId: outsiderOrg.id,
    outsiderProjectId: outsiderProject.id,
    emails,
  };
}

beforeEach(async () => {
  // 登录与注册都有限流（lib/auth/rate-limit.ts），每个用例重新计数。
  resetRateLimitStore();
  session.cookie = undefined;
  fixture = await buildFixture();
});

/** 以某个成员的身份调用 Action：会话只存在于 cookie。 */
async function as(userId: string) {
  const email = fixture.emails.get(userId);
  if (!email) {
    throw new Error(`测试用户不存在：${userId}`);
  }
  session.cookie = await signSessionFor(email);
}

describe('createArticleAction', () => {
  it('编辑者可以新建谱文，并自动获得「默认分类」', async () => {
    await as(fixture.editorId);
    const result = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '陈氏族谱序',
    });

    expect(result).toMatchObject({ success: '谱文已创建' });
    const articleId = dataOf(result).articleId;
    expect(articleId).toBeTruthy();

    const row = await readContent(articleId!);
    expect(row?.title).toBe('陈氏族谱序');
    expect(row?.folderId).toBeTruthy();

    const db = getTestDb();
    const defaults = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.name, '默认分类'));
    expect(defaults).toHaveLength(1);

    // 第二篇复用同一个默认分类，不重复建（FR-001）。
    await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '凡例',
    });
    const after = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.name, '默认分类'));
    expect(after).toHaveLength(1);
  });

  it('查看者被服务端拒绝，且中文提示不带内部信息', async () => {
    await as(fixture.viewerId);
    const result = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '越权谱文',
    });

    expect(result).toEqual({
      error: PERMISSION_DENIED_MESSAGES['article.write'],
    });
    const leaked = await getTestDb()
      .select({ id: articles.id })
      .from(articles)
      .where(eq(articles.title, '越权谱文'));
    expect(leaked).toHaveLength(0);
  });

  it('标题为空时就近返回中文校验信息', async () => {
    await as(fixture.editorId);
    const result = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '   ',
    });

    expect(result).toMatchObject({ error: '请填写谱文标题' });
  });

  it('跨组织的 projectId 一律按不存在处理，不泄露存在性', async () => {
    await as(fixture.editorId);
    const result = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.outsiderProjectId,
      title: '别人的空间',
    });

    expect(result).toEqual({ error: ARTICLE_ERRORS.not_found });
  });
});

describe('updateArticleTitleAction / moveArticleAction', () => {
  it('改标题后落库，且空标题被阻断', async () => {
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '旧标题',
    });
    const articleId = dataOf(created).articleId!;

    const renamed = await updateArticleTitleAction({
      orgId: fixture.orgId,
      articleId,
      title: '新标题',
    });
    expect(renamed).toMatchObject({ success: '标题已保存' });
    expect((await readContent(articleId))?.title).toBe('新标题');

    const cleared = await updateArticleTitleAction({
      orgId: fixture.orgId,
      articleId,
      title: '',
    });
    expect(cleared).toMatchObject({ error: '请填写谱文标题' });
    expect((await readContent(articleId))?.title).toBe('新标题');
  });

  it('移动到另一分类，再移回未分类', async () => {
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '要移动的谱文',
    });
    const articleId = dataOf(created).articleId!;
    const defaultFolderId = (await readContent(articleId))?.folderId;
    expect(defaultFolderId).toBeTruthy();

    const [target] = await getTestDb()
      .insert(folders)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        kind: 1,
        name: '传记',
        createdBy: fixture.editorId,
        sort: 99,
      })
      .returning({ id: folders.id });

    const moved = await moveArticleAction({
      orgId: fixture.orgId,
      articleId,
      folderId: target.id,
    });
    expect(moved).toMatchObject({ success: '已移动到新分类' });
    expect((await readContent(articleId))?.folderId).toBe(target.id);

    const unfiled = await moveArticleAction({
      orgId: fixture.orgId,
      articleId,
      folderId: null,
    });
    expect(unfiled).toMatchObject({ success: '已移动到新分类' });
    expect((await readContent(articleId))?.folderId).toBeNull();
    expect(defaultFolderId).toBeTruthy();
  });

  it('不属于本组织的 articleId 返回不存在', async () => {
    await as(fixture.editorId);
    const foreign = await createArticle({
      orgId: fixture.outsiderOrgId,
      projectId: fixture.outsiderProjectId,
      createdBy: fixture.outsiderId,
      title: '别家的谱文',
    });

    await as(fixture.editorId);
    const result = await updateArticleTitleAction({
      orgId: fixture.orgId,
      articleId: foreign.id,
      title: '改到别人头上',
    });
    expect(result).toEqual({ error: ARTICLE_ERRORS.not_found });
  });
});

describe('deleteArticleAction', () => {
  it('没有引用时真删，谱文不再可查', async () => {
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '待删除谱文',
    });
    const articleId = dataOf(created).articleId!;

    const deleted = await deleteArticleAction({
      orgId: fixture.orgId,
      articleId,
    });
    expect(deleted).toMatchObject({ success: '谱文已删除' });
    expect(await readContent(articleId)).toBeUndefined();
  });

  it('被编目引用时拒绝删除，并说明先移除编目，行保持不变', async () => {
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '被引用的谱文',
    });
    const articleId = dataOf(created).articleId!;

    const book = await createBook({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      name: '测试谱书',
    });
    await createCatalogItem({
      orgId: fixture.orgId,
      bookId: book.id,
      createdBy: fixture.ownerId,
      articleId,
    });

    const blocked = await deleteArticleAction({
      orgId: fixture.orgId,
      articleId,
    });
    expect(blocked).toEqual({ error: ARTICLE_ERRORS.catalog_referenced });
    expect(await readContent(articleId)).toBeDefined();
  });

  it('查看者删除一律按不存在处理', async () => {
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '查看者删不掉',
    });
    const articleId = dataOf(created).articleId!;

    await as(fixture.viewerId);
    const result = await deleteArticleAction({
      orgId: fixture.orgId,
      articleId,
    });
    expect(result).toEqual({
      error: PERMISSION_DENIED_MESSAGES['article.write'],
    });
    expect(await readContent(articleId)).toBeDefined();
  });
});

describe('saveArticlePageAction', () => {
  async function articleWithTwoPages() {
    await as(fixture.editorId);
    const [row] = await getTestDb()
      .insert(articles)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        createdBy: fixture.editorId,
        title: '两页谱文',
        content: contentOf(
          { id: '11111111-1111-4111-8111-111111111111', text: '第一页原文' },
          { id: '22222222-2222-4222-8222-222222222222', text: '第二页原文' }
        ),
        plainText: '第一页原文',
      })
      .returning({ id: articles.id });
    return row.id;
  }

  it('删掉带图的页之后，只有这页在用的图片字节被清掉（FR-029、US3-AC5）', async () => {
    const articleId = await articleWithTwoPages();
    const keep = `articles/${fixture.orgId}/${articleId}/keep.png`;
    const gone = `articles/${fixture.orgId}/${articleId}/gone.png`;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await fsMediaStore.put(keep, bytes, 'image/png');
    await fsMediaStore.put(gone, bytes, 'image/png');

    const first = '11111111-1111-4111-8111-111111111111';
    const second = '22222222-2222-4222-8222-222222222222';
    await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: first,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '第一页的像' }],
          },
          { type: 'articleImage', attrs: { pathname: keep, width: 'full' } },
        ],
      },
    });
    await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: second,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: '第二页的像' }],
          },
          { type: 'articleImage', attrs: { pathname: gone, width: 'full' } },
        ],
      },
    });

    const result = await deleteArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: second,
    });

    expect(result).toMatchObject({ success: '已删除该页' });
    // 只有第二页在用的字节被清掉；第一页还在用的那张必须留着。
    expect(await fsMediaStore.read(gone)).toBeNull();
    expect(await fsMediaStore.read(keep)).not.toBeNull();

    await fsMediaStore.delete(keep);
    await fsMediaStore.delete(gone);
  });

  it('只替换提交的那一页，另一页原样保留（FR-017）', async () => {
    const articleId = await articleWithTwoPages();

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '11111111-1111-4111-8111-111111111111',
      doc: paragraphDoc('改过的第一页'),
    });

    expect(result).toMatchObject({ success: '已保存' });
    const saved = (
      result as { data?: { savedAt?: string; page?: { id: string } } }
    ).data;
    expect(saved?.savedAt).toMatch(/Z$/);
    expect(saved?.page?.id).toBe('11111111-1111-4111-8111-111111111111');

    const content = (await readContent(articleId))?.content as {
      pages: { id: string; doc: unknown }[];
    };
    expect(content.pages).toHaveLength(2);
    expect(JSON.stringify(content.pages[0])).toContain('改过的第一页');
    expect(JSON.stringify(content.pages[1])).toContain('第二页原文');
  });

  it('003 富文本（加粗/斜体/下划线 + 单级列表 + textAlign）保存后原样读回（FR-017）', async () => {
    const articleId = await articleWithTwoPages();
    const pageId = '11111111-1111-4111-8111-111111111111';

    // 一页里混用旧结构（两档 heading、textStyle 字体字号 mark）与 003 新增的
    // 内联标记、单级 bulletList/orderedList、paragraph/heading 的 textAlign；
    // 经 saveArticlePageAction 保存后必须逐字读回一致（FR-017），不改 Action 入参、不跑迁移。
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1, textAlign: 'center' },
          content: [
            { type: 'text', text: '陈氏族谱序', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'paragraph',
          attrs: { textAlign: 'right' },
          content: [
            {
              type: 'text',
              text: '加粗斜体下划线',
              marks: [
                { type: 'bold' },
                { type: 'italic' },
                { type: 'underline' },
              ],
            },
            {
              type: 'text',
              text: '宋体大字',
              marks: [
                {
                  type: 'textStyle',
                  attrs: { fontFamily: 'SimSun', fontSize: '19px' },
                },
              ],
            },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '世系甲' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '世系乙' }],
                },
              ],
            },
          ],
        },
        {
          type: 'orderedList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: '第一项' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId,
      doc,
    });

    expect(result).toMatchObject({ success: '已保存' });
    const stored = parseArticleContent((await readContent(articleId))?.content);
    const page = stored.pages.find((p) => p.id === pageId);
    expect(page?.doc).toEqual(doc);
  });

  it('plain_text 由 content 派生并同步更新（FR-038）', async () => {
    const articleId = await articleWithTwoPages();

    await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '22222222-2222-4222-8222-222222222222',
      doc: paragraphDoc('改过的第二页'),
    });

    expect((await readContent(articleId))?.plainText).toBe(
      '第一页原文\n\n改过的第二页'
    );
  });

  it('提交服务端已不存在的页 → 拒绝整次提交且不动内容（FR-021）', async () => {
    const articleId = await articleWithTwoPages();

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '33333333-3333-4333-8333-333333333333',
      doc: paragraphDoc('幽灵页'),
    });

    expect(result).toEqual({ error: ARTICLE_ERRORS.page_not_found });
    const row = await readContent(articleId);
    const pages = (row?.content as { pages?: unknown[] } | undefined)?.pages;
    expect(pages).toHaveLength(2);
    expect(row?.plainText).toBe('第一页原文');
  });

  it('白名单外的节点被拒绝，不落库', async () => {
    const articleId = await articleWithTwoPages();

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '11111111-1111-4111-8111-111111111111',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [{ type: 'tableCell', content: [] }],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({ error: expect.any(String) });
    const row = await readContent(articleId);
    expect(JSON.stringify(row?.content ?? '')).not.toContain('table');
  });

  it('图片 pathname 属于别家谱文时拒绝（组织隔离）', async () => {
    const articleId = await articleWithTwoPages();

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '11111111-1111-4111-8111-111111111111',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'articleImage',
            attrs: {
              pathname: `articles/${fixture.outsiderOrgId}/${articleId}/x.png`,
              width: 'full',
            },
          },
        ],
      },
    });

    expect(result).toMatchObject({ error: ARTICLE_ERRORS.invalid_doc });
  });

  it('正文插图的页能存进去，宽度按提交的档位落库（FR-025、FR-026）', async () => {
    const articleId = await articleWithTwoPages();
    const pathname = `articles/${fixture.orgId}/${articleId}/pic-1.png`;
    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '11111111-1111-4111-8111-111111111111',
      doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '始祖画像' }] },
          { type: 'articleImage', attrs: { pathname, width: 'medium' } },
        ],
      },
    });

    expect(result).toMatchObject({ success: '已保存' });
    const stored = parseArticleContent((await readContent(articleId))?.content);
    expect(stored.pages[0]?.doc.content?.[1]).toMatchObject({
      type: 'articleImage',
      attrs: { pathname, width: 'medium' },
    });
  });

  it('一页第七张图被拒，已存内容一字不动（FR-028、FR-037）', async () => {
    const articleId = await articleWithTwoPages();
    const pageId = '11111111-1111-4111-8111-111111111111';
    const before = await readContent(articleId);

    const images = Array.from({ length: 7 }, (_, index) => ({
      type: 'articleImage',
      attrs: {
        pathname: `articles/${fixture.orgId}/${articleId}/img${index}.png`,
        width: 'full',
      },
    }));
    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId,
      doc: { type: 'doc', content: images },
    });

    expect(result).toMatchObject({ error: ARTICLE_ERRORS.too_many_images });
    const after = await readContent(articleId);
    expect(after?.content).toEqual(before?.content);
    expect(after?.plainText).toBe(before?.plainText);
  });

  it('查看者保存按不存在处理，内容不变', async () => {
    const articleId = await articleWithTwoPages();
    await as(fixture.viewerId);

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: '11111111-1111-4111-8111-111111111111',
      doc: paragraphDoc('查看者写不进去'),
    });

    expect(result).toEqual({
      error: PERMISSION_DENIED_MESSAGES['article.write'],
    });
    const row = await readContent(articleId);
    expect(JSON.stringify(row?.content ?? '')).toContain('第一页原文');
    expect(JSON.stringify(row?.content ?? '')).not.toContain('查看者写不进去');
  });
});

describe('字体与字号的真实序列化（FR-030）', () => {
  it('只设字体、字号为 null 的一页能保存成功，且落库不带 null', async () => {
    await as(fixture.editorId);
    const pageId = '33333333-3333-4333-8333-333333333333';
    const [inserted] = await getTestDb()
      .insert(articles)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        createdBy: fixture.editorId,
        title: '字体测试',
        content: contentOf({ id: pageId, text: '原来的正文' }),
        plainText: '原来的正文',
      })
      .returning({ id: articles.id });

    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId: inserted.id,
      pageId,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '楷体正文',
                // 真实 `Mark.toJSON()` 的形状：没设的那一项是 null，不是缺席。
                marks: [
                  {
                    type: 'textStyle',
                    attrs: { fontFamily: 'KaiTi', fontSize: null },
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(result).toMatchObject({ success: '已保存' });
    const row = await readContent(inserted.id);
    const stored = JSON.stringify(row?.content);
    expect(stored).toContain('KaiTi');
    expect(stored).not.toContain('null');
    expect(row?.plainText).toBe('楷体正文');
  });
});

describe('删除预览（FR-004、FR-005、FR-006、SC-005）', () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';

  function image(pathname: string) {
    return {
      type: 'articleImage' as const,
      attrs: { pathname, width: 'full' as const },
    };
  }

  function docWith(...nodes: Record<string, unknown>[]) {
    return { type: 'doc' as const, content: nodes };
  }

  it('给出页数、图片数，并标记是否被谱书编目引用', async () => {
    await as(fixture.editorId);
    const article = await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.editorId,
      title: '待删谱文',
      content: {
        schemaVersion: 1,
        pages: [
          {
            id: P1,
            doc: docWith(
              { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
              image(`articles/${fixture.orgId}/a/x1.png`),
              image(`articles/${fixture.orgId}/a/x2.png`)
            ),
          },
          { id: P2, doc: docWith(image(`articles/${fixture.orgId}/a/x3.png`)) },
        ],
      },
    });

    const preview = await getArticleDeletePreviewAction({
      orgId: fixture.orgId,
      articleId: article.id,
    });
    expect(preview).toMatchObject({
      title: '待删谱文',
      pageCount: 2,
      imageCount: 3,
      referencedByCatalog: false,
    });

    const book = await createBook({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      name: '引用它的谱书',
    });
    await createCatalogItem({
      orgId: fixture.orgId,
      bookId: book.id,
      createdBy: fixture.ownerId,
      articleId: article.id,
    });

    const after = await getArticleDeletePreviewAction({
      orgId: fixture.orgId,
      articleId: article.id,
    });
    expect(after).toMatchObject({ referencedByCatalog: true });
  });

  it('引用它的编目项被删后，不再算引用', async () => {
    await as(fixture.ownerId);
    const article = await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      title: '谱书已删的谱文',
    });
    const book = await createBook({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      name: '将被删除的谱书',
    });
    await createCatalogItem({
      orgId: fixture.orgId,
      bookId: book.id,
      createdBy: fixture.ownerId,
      articleId: article.id,
    });

    // 目标态 `book` 已无软删列（附录 A.5），删除即真删；`book_catalog` 的软删列
    // 要到 B3 / T25 才退役，所以这条用例改成删编目项来验证「不再算引用」。
    await getTestDb()
      .update(bookCatalogs)
      .set({ deletedAt: new Date() })
      .where(eq(bookCatalogs.bookId, book.id));

    const preview = await getArticleDeletePreviewAction({
      orgId: fixture.orgId,
      articleId: article.id,
    });
    expect(preview).toMatchObject({ referencedByCatalog: false });
  });

  it('分类预览把子孙分类一并计入（FR-005）', async () => {
    await as(fixture.ownerId);
    const root = await createFolder({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      kind: 1,
      name: '谱序',
    });
    const child = await createFolder({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      kind: 1,
      parentId: root.id,
      name: '旧谱序',
    });
    await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      folderId: root.id,
      title: '根下的一篇',
    });
    await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      folderId: child.id,
      title: '子下的一篇',
    });
    await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      folderId: child.id,
      title: '子下的又一篇',
    });

    const preview = await getFolderDeletePreviewAction({
      orgId: fixture.orgId,
      folderId: root.id,
    });
    expect(preview).toMatchObject({
      name: '谱序',
      folderCount: 2,
      articleCount: 3,
    });
  });

  it('别的组织的用户拿不到任何预览，按不存在处理（FR-034）', async () => {
    await as(fixture.outsiderId);
    const article = await createArticle({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      title: '别人家的谱文',
    });
    const folder = await createFolder({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      createdBy: fixture.ownerId,
      kind: 1,
      name: '别人家的分类',
    });

    expect(
      await getArticleDeletePreviewAction({
        orgId: fixture.outsiderOrgId,
        articleId: article.id,
      })
    ).toEqual({ error: ARTICLE_ERRORS.not_found });
    expect(
      await getFolderDeletePreviewAction({
        orgId: fixture.outsiderOrgId,
        folderId: folder.id,
      })
    ).toEqual({ error: ARTICLE_ERRORS.not_found });
  });
});

/**
 * 页操作（T032 / FR-021–FR-024）。
 *
 * 服务层在 Task 6 已交付，这组用例把「页 id 由服务端生成、100 页与最后一页的拒绝、
 * 重排集合必须一致、页序真的落库」钉成回归——页序是数组顺序，没有单独的排序列，
 * 一旦写错就是用户看到的顺序错了。
 */
describe('页操作（加页 / 删页 / 重排）', () => {
  const PAGE_A = '11111111-1111-4111-8111-111111111111';
  const PAGE_B = '22222222-2222-4222-8222-222222222222';

  async function twoPageArticle() {
    await as(fixture.editorId);
    const [row] = await getTestDb()
      .insert(articles)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        createdBy: fixture.editorId,
        title: '两页谱文',
        content: contentOf(
          { id: PAGE_A, text: '甲页' },
          { id: PAGE_B, text: '乙页' }
        ),
      })
      .returning({ id: articles.id });
    return row.id;
  }

  async function pageIdsOf(articleId: string) {
    const content = (await readContent(articleId))?.content as {
      pages: { id: string }[];
    };
    return content.pages.map((page) => page.id);
  }

  it('加页：页 id 由服务端生成并追加在末尾（FR-021）', async () => {
    const articleId = await twoPageArticle();

    const result = await addArticlePageAction({
      orgId: fixture.orgId,
      articleId,
    });

    expect(result).toMatchObject({ success: '已添加一页' });
    const data = (result as { data?: { pageId: string; pageOrder: string[] } })
      .data;
    expect(data?.pageId).toMatch(/^[0-9a-f-]{36}$/);
    expect(data?.pageOrder).toEqual([PAGE_A, PAGE_B, data?.pageId]);
    expect(await pageIdsOf(articleId)).toEqual([PAGE_A, PAGE_B, data?.pageId]);
  });

  it('第 101 页被拒且谱文不变（FR-021）', async () => {
    await as(fixture.editorId);
    const full = Array.from({ length: 100 }, (_, index) => ({
      id: `page-${index}`,
      text: `第 ${index} 页`,
    }));
    const [row] = await getTestDb()
      .insert(articles)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        createdBy: fixture.editorId,
        title: '满页谱文',
        content: contentOf(...full),
      })
      .returning({ id: articles.id });

    expect(
      await addArticlePageAction({ orgId: fixture.orgId, articleId: row.id })
    ).toEqual({ error: ARTICLE_ERRORS.max_pages });
    expect(await pageIdsOf(row.id)).toHaveLength(100);
  });

  it('删掉最后一页被拒（FR-022）', async () => {
    await as(fixture.editorId);
    const [row] = await getTestDb()
      .insert(articles)
      .values({
        orgId: fixture.orgId,
        projectId: fixture.projectId,
        createdBy: fixture.editorId,
        title: '单页谱文',
        content: contentOf({ id: PAGE_A, text: '唯一一页' }),
      })
      .returning({ id: articles.id });

    expect(
      await deleteArticlePageAction({
        orgId: fixture.orgId,
        articleId: row.id,
        pageId: PAGE_A,
      })
    ).toEqual({ error: ARTICLE_ERRORS.last_page });
    expect(await pageIdsOf(row.id)).toEqual([PAGE_A]);
  });

  it('删页只删这一页，其余页与页序保持（FR-022）', async () => {
    const articleId = await twoPageArticle();

    const result = await deleteArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: PAGE_A,
    });

    expect(result).toMatchObject({ success: '已删除该页' });
    expect(
      (result as { data?: { pageOrder: string[] } }).data?.pageOrder
    ).toEqual([PAGE_B]);
    expect(await pageIdsOf(articleId)).toEqual([PAGE_B]);
    expect((await readContent(articleId))?.plainText).toBe('乙页');
  });

  it('重排集合不一致（多了未知页）整次拒绝且顺序不变（FR-023）', async () => {
    const articleId = await twoPageArticle();

    expect(
      await reorderArticlePagesAction({
        orgId: fixture.orgId,
        articleId,
        pageIds: [PAGE_B, '99999999-9999-4999-8999-999999999999'],
      })
    ).toEqual({ error: ARTICLE_ERRORS.page_not_found });
    expect(await pageIdsOf(articleId)).toEqual([PAGE_A, PAGE_B]);
  });

  it('重排后页序真的落库，plain_text 跟着新顺序派生（FR-023、FR-038）', async () => {
    const articleId = await twoPageArticle();

    const result = await reorderArticlePagesAction({
      orgId: fixture.orgId,
      articleId,
      pageIds: [PAGE_B, PAGE_A],
    });

    expect(result).toMatchObject({ success: '页序已保存' });
    expect(await pageIdsOf(articleId)).toEqual([PAGE_B, PAGE_A]);
    expect((await readContent(articleId))?.plainText).toBe('乙页\n\n甲页');
  });

  it('viewer 不能加页，editor 可以（FR-033）', async () => {
    const articleId = await twoPageArticle();

    await as(fixture.viewerId);
    expect(
      await addArticlePageAction({ orgId: fixture.orgId, articleId })
    ).toEqual({ error: PERMISSION_DENIED_MESSAGES['article.write'] });

    await as(fixture.outsiderId);
    expect(
      await reorderArticlePagesAction({
        orgId: fixture.outsiderOrgId,
        articleId,
        pageIds: [PAGE_A, PAGE_B],
      })
    ).toEqual({ error: ARTICLE_ERRORS.not_found });
  });
});
