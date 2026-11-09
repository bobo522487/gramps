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
import { fsMediaExists } from '@/lib/article/media/fs-store';
import { PERMISSION_DENIED_MESSAGES } from '@/lib/auth/permissions';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
import { articles } from '@/lib/db/schema';
import { signSessionFor } from '../helpers/auth';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

/**
 * 谱文这条线的安全回归（Task 12 / FR-033..FR-036、评审列的「越权面」）。
 *
 * `articles.test.ts` 逐条测功能，这个文件只测**边界姿态**：
 * 未登录、只读角色、外组织成员、伪造前缀、以及「内部信息不回显」。
 * 每条都往真实库里落一次，验证拒绝路径真的没有副作用。
 */

const session = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

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
  emails: Map<string, string>;
};

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

let fixture: Fixture;

async function buildFixture(): Promise<Fixture> {
  const owner = await createUser();
  const emails = new Map<string, string>();
  const org = await createOrganization({ name: '谱文安全回归组织' });
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
  return {
    orgId: org.id,
    projectId: project.id,
    ownerId: owner.id,
    editorId: editor.id,
    viewerId: viewer.id,
    outsiderId: outsider.id,
    outsiderOrgId: outsiderPersonal.organization.id,
    emails,
  };
}

async function as(userId: string) {
  const email = fixture.emails.get(userId);
  if (!email) {
    throw new Error(`测试用户不存在：${email}`);
  }
  session.cookie = await signSessionFor(email);
}

/** 用 owner 身份建一篇两页的谱文，返回 articleId 与页 id。 */
async function seedArticle(): Promise<{
  articleId: string;
  pageIds: string[];
}> {
  await as(fixture.ownerId);
  const created = await createArticleAction({
    orgId: fixture.orgId,
    projectId: fixture.projectId,
    title: '安全回归用谱文',
  });
  const articleId = dataOf(created).articleId;
  const added = await addArticlePageAction({ orgId: fixture.orgId, articleId });
  const row = await rowOf(articleId);
  const pages = parseArticleContent(row?.body).pages.map((page) => page.id);
  return { articleId, pageIds: [...pages, dataOf(added).pageId] };
}

async function rowOf(articleId: string) {
  const [row] = await getTestDb()
    .select({
      title: articles.title,
      body: articles.body,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  return row;
}

async function articleCount(): Promise<number> {
  const all = await getTestDb().select({ id: articles.id }).from(articles);
  return all.length;
}

beforeEach(async () => {
  resetRateLimitStore();
  session.cookie = undefined;
  fixture = await buildFixture();
});

describe('未登录', () => {
  it('十个谱文 Action 全部返回未登录的中文提示，且不新增任何行', async () => {
    const { articleId, pageIds } = await seedArticle();
    // 匿名调用在取会话那一步就被拒，所以这里不需要真实分类 id。
    const folderId = crypto.randomUUID();
    session.cookie = undefined;

    const before = await articleCount();
    const payloads = [
      () =>
        createArticleAction({
          orgId: fixture.orgId,
          projectId: fixture.projectId,
          title: '匿名新建',
        }),
      () =>
        updateArticleTitleAction({
          orgId: fixture.orgId,
          articleId,
          title: '匿名改名',
        }),
      () =>
        moveArticleAction({ orgId: fixture.orgId, articleId, folderId: null }),
      () => deleteArticleAction({ orgId: fixture.orgId, articleId }),
      () =>
        saveArticlePageAction({
          orgId: fixture.orgId,
          articleId,
          pageId: pageIds[0],
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', text: '匿名写入' }],
          },
        }),
      () => addArticlePageAction({ orgId: fixture.orgId, articleId }),
      () =>
        deleteArticlePageAction({
          orgId: fixture.orgId,
          articleId,
          pageId: pageIds[1],
        }),
      () =>
        reorderArticlePagesAction({
          orgId: fixture.orgId,
          articleId,
          pageIds: [...pageIds].reverse(),
        }),
      () => getArticleDeletePreviewAction({ orgId: fixture.orgId, articleId }),
      // 预览类也是读接口，同样不许匿名调用（它照样得给出中文拒绝）。
      () => getFolderDeletePreviewAction({ orgId: fixture.orgId, folderId }),
    ];

    for (const call of payloads) {
      const result = await call();
      expect(result).toMatchObject({ code: 'UNAUTHORIZED' });
      if ('error' in result && typeof result.error === 'string') {
        expect(result.error).toContain('登录');
        // 内部信息不回显：不给堆栈、不给 SQL、不给英文码。
        expect(result.error).not.toMatch(/at\s+\w+.*\(.*:\d+:\d+\)/);
        expect(result.error).not.toMatch(/select|insert into|relation "/i);
      }
    }
    expect(await articleCount()).toBe(before);
    const row = await rowOf(articleId);
    expect(row?.title).toBe('安全回归用谱文');
  });
});

describe('只读角色（viewer）', () => {
  it('八个写 Action 逐个被拒，用的就是权限矩阵里那条中文文案', async () => {
    const { articleId, pageIds } = await seedArticle();
    const before = await rowOf(articleId);
    await as(fixture.viewerId);

    const denied = PERMISSION_DENIED_MESSAGES['article.write'];
    const calls = [
      () =>
        createArticleAction({
          orgId: fixture.orgId,
          projectId: fixture.projectId,
          title: '查看者新建',
        }),
      () =>
        updateArticleTitleAction({
          orgId: fixture.orgId,
          articleId,
          title: '查看者改名',
        }),
      () =>
        moveArticleAction({ orgId: fixture.orgId, articleId, folderId: null }),
      () => deleteArticleAction({ orgId: fixture.orgId, articleId }),
      () =>
        saveArticlePageAction({
          orgId: fixture.orgId,
          articleId,
          pageId: pageIds[0],
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', text: '查看者写入' }],
          },
        }),
      () => addArticlePageAction({ orgId: fixture.orgId, articleId }),
      () =>
        deleteArticlePageAction({
          orgId: fixture.orgId,
          articleId,
          pageId: pageIds[1],
        }),
      () =>
        reorderArticlePagesAction({ orgId: fixture.orgId, articleId, pageIds }),
    ];

    for (const call of calls) {
      const result = await call();
      expect(result).toMatchObject({ error: denied });
    }

    const after = await rowOf(articleId);
    expect(after?.body).toEqual(before?.body);
  });

  it('查看者能取到删除预览，但预览只给计数、不给正文（读能力，不是写口子）', async () => {
    const { articleId } = await seedArticle();
    await as(fixture.viewerId);
    const result = await getArticleDeletePreviewAction({
      orgId: fixture.orgId,
      articleId,
    });
    if ('error' in result) {
      throw new Error(`查看者取预览失败：${result.error}`);
    }
    // 预览是只读通道：成员可见，但载荷里没有正文，拿到它也写不进任何东西。
    expect(Object.keys(result).sort()).toEqual(
      ['imageCount', 'pageCount', 'referencedByCatalog', 'title'].sort()
    );
    const write = await deleteArticleAction({
      orgId: fixture.orgId,
      articleId,
    });
    expect(write).toMatchObject({
      error: PERMISSION_DENIED_MESSAGES['article.write'],
    });
  });
});

describe('组织隔离', () => {
  it('外组织成员用「自己的 orgId + 别人的 articleId」只能得到不存在', async () => {
    const { articleId, pageIds } = await seedArticle();
    const before = await rowOf(articleId);
    await as(fixture.outsiderId);

    const calls = await Promise.all([
      updateArticleTitleAction({
        orgId: fixture.outsiderOrgId,
        articleId,
        title: '越权改名',
      }),
      deleteArticleAction({ orgId: fixture.outsiderOrgId, articleId }),
      getArticleDeletePreviewAction({
        orgId: fixture.outsiderOrgId,
        articleId,
      }),
      addArticlePageAction({ orgId: fixture.outsiderOrgId, articleId }),
      deleteArticlePageAction({
        orgId: fixture.outsiderOrgId,
        articleId,
        pageId: pageIds[0],
      }),
      reorderArticlePagesAction({
        orgId: fixture.outsiderOrgId,
        articleId,
        pageIds,
      }),
      saveArticlePageAction({
        orgId: fixture.outsiderOrgId,
        articleId,
        pageId: pageIds[0],
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', text: '越权写入' }],
        },
      }),
    ]);

    for (const result of calls) {
      expect(result).toMatchObject({ error: ARTICLE_ERRORS.not_found });
    }
    const after = await rowOf(articleId);
    expect(after?.body).toEqual(before?.body);
    expect(after?.title).toBe('安全回归用谱文');
  });

  it('外组织的 projectId 建不出谱文，也不会多出一行', async () => {
    await as(fixture.outsiderId);
    const result = await createArticleAction({
      orgId: fixture.outsiderOrgId,
      projectId: fixture.projectId,
      title: '跨组织建篇',
    });
    expect(result).toMatchObject({ error: ARTICLE_ERRORS.not_found });
    const rows = await getTestDb().select({ id: articles.id }).from(articles);
    expect(rows).toHaveLength(0);
  });

  it('把图片 pathname 伪造成别家的前缀，保存被拒且原内容不动', async () => {
    const { articleId, pageIds } = await seedArticle();
    const before = await rowOf(articleId);
    await as(fixture.editorId);
    const foreign = `articles/${fixture.outsiderOrgId}/${articleId}/evil.png`;
    const result = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId: pageIds[0],
      doc: {
        type: 'doc',
        content: [
          { type: 'articleImage', attrs: { pathname: foreign, width: 'full' } },
        ],
      },
    });
    expect(result).toMatchObject({ error: ARTICLE_ERRORS.invalid_doc });
    const after = await rowOf(articleId);
    expect(after?.body).toEqual(before?.body);
  });

  it('本地上传通道拒绝把文件写进别人谱文的路径，且字节不落盘', async () => {
    const { articleId } = await seedArticle();
    await as(fixture.outsiderId);
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48,
      0x44, 0x52,
    ]);
    const form = new FormData();
    form.set('orgId', fixture.outsiderOrgId);
    form.set('articleId', articleId);
    form.set('file', new File([png], 'evil.png', { type: 'image/png' }));

    const { POST } = await import('@/app/api/media/upload/route');
    const response = await POST(
      new Request('http://localhost/api/media/upload', {
        method: 'POST',
        body: form,
      })
    );
    expect(response.status).toBe(404);
    expect(
      await fsMediaExists(`articles/${fixture.outsiderOrgId}/${articleId}/`)
    ).toBe(false);
  });
});

describe('内容里的脚本与 SQL 片段', () => {
  it('标题与正文按原样存储，派生文本里不含标签，也不改变数据', async () => {
    const hostileTitle = '<script>alert(1)</script>谱序; drop table article;--';
    await as(fixture.editorId);
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: hostileTitle,
    });
    const articleId = dataOf(created).articleId;
    const first = await rowOf(articleId);
    const pageId = parseArticleContent(first?.body).pages[0].id;

    const saved = await saveArticlePageAction({
      orgId: fixture.orgId,
      articleId,
      pageId,
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '<img src=x onerror=alert(2)> 1 OR 1=1 --',
              },
            ],
          },
        ],
      },
    });
    expect(saved).toMatchObject({ success: '已保存' });

    const row = await rowOf(articleId);
    expect(row?.title).toBe(hostileTitle);
    // 恶意文本按字面存进 body（JSON 不转义 < >），不执行、不丢字。
    expect(row?.body).toContain('<img src=x onerror=alert(2)> 1 OR 1=1 --');
    expect(row?.body).not.toContain('<script>');
    // 表还在：注入没有改变数据库状态。
    const folders = await getTestDb()
      .select({ id: articles.id })
      .from(articles)
      .limit(1);
    expect(folders).toHaveLength(1);
  });
});
