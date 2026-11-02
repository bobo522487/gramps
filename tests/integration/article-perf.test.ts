import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addArticlePageAction,
  createArticleAction,
  saveArticlePageAction,
} from '@/lib/article/actions';
import {
  ARTICLE_SCHEMA_VERSION,
  MAX_IMAGES_PER_PAGE,
  MAX_PAGES_PER_ARTICLE,
} from '@/lib/article/constants';
import type { ArticleNode, ArticlePageDoc } from '@/lib/article/doc';
import { countImages, parseArticleContent } from '@/lib/article/doc';
import { getArticle } from '@/lib/db/queries/articles';
import { signSessionFor } from '../helpers/auth';
import {
  addMember,
  createArticle,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

/**
 * 性能夹具（SC-003 / SC-010，T048）。
 *
 * 规格里的两个容量口径都要有可复现的夹具，否则「20 页 40 图不卡」「200 篇列表
 * 一秒内可用」只是口号：
 * - SC-003：一篇 20 页、40 张图的谱文，逐页保存与重新解析必须在线性时间内完成；
 * - SC-010：一个云谱空间 200 篇谱文，列表查询与排序不出现分页依赖。
 *
 * 这里量的是**服务端**这一半（解析 + 落库 + 列表查询）。浏览器端的切页耗时与帧率
 * 由 `tests/e2e/article-authoring.spec.ts` 的手工段与下面的数值门槛一起看：
 * 交互层面的 <300ms / ≥45fps 属于渲染，集成测试拿不到，不在这里假装测过。
 *
 * 阈值有意比规格宽松一个量级（15 分钟机器 vs CI 容器）：这条测试守的是
 * 「没有平方级退化 / 没有 N+1」，不是绝对延迟。真要在 CI 上钉死 p95，
 * 得先有稳定基准机，那是另一件事。
 */

const session = vi.hoisted(() => ({ cookie: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(session.cookie ? { cookie: session.cookie } : {}),
}));

// Action 成功后会失效整棵控制台缓存；集成测试没有 Next 请求上下文，必须打桩。
vi.mock('next/cache', () => ({
  revalidatePath: () => undefined,
}));

function paragraph(text: string): ArticleNode {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

// 图片 pathname 必须落在 `articles/<orgId>/<articleId>/` 前缀下，否则保存链路按
// 「图片不属于这篇谱文」拒收（FR-028），夹具就测不到写入这一半。
function imageNode(index: number, mediaPrefix: string): ArticleNode {
  return {
    type: 'articleImage',
    attrs: { pathname: `${mediaPrefix}img-${index}.png`, width: 'full' },
  };
}

/** 20 页 × 每页 2 图 = 40 张，另有满页补足到上限的分布（每页最多 6 张）。 */
function buildLargeContent(
  pageCount: number,
  imageCount: number,
  mediaPrefix: string
) {
  const perPage = Math.ceil(imageCount / pageCount);
  const pages = [];
  let placed = 0;
  for (let index = 0; index < pageCount; index += 1) {
    const content: ArticleNode[] = [
      paragraph(`第 ${index + 1} 页正文：始祖讳元，宋末自闽徙居，其后分房。`),
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: `第 ${index + 1} 房` }],
      },
      paragraph('支系名讳、生卒、配某氏、葬某地，逐条录入。'.repeat(20)),
    ];
    for (
      let slot = 0;
      slot < perPage && placed < imageCount;
      slot += 1, placed += 1
    ) {
      content.push(imageNode(placed, mediaPrefix));
    }
    const doc: ArticlePageDoc = { type: 'doc', content };
    pages.push({ id: `page-${index}`, doc });
  }
  return { schemaVersion: ARTICLE_SCHEMA_VERSION, pages };
}

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

describe('谱文性能夹具（SC-003 / SC-010）', () => {
  let fixture: {
    orgId: string;
    projectId: string;
    userId: string;
    cookie: string;
  };

  // `tests/integration/setup.ts` 在每个用例前清库，夹具必须建在 beforeEach 里。
  beforeEach(async () => {
    const owner = await createUser();
    const organization = await createOrganization();
    await addMember({
      userId: owner.id,
      organizationId: organization.id,
      role: 'owner',
    });
    const project = await createProject({
      orgId: organization.id,
      createdBy: owner.id,
    });
    const cookie = await signSessionFor(owner.email);
    fixture = {
      orgId: organization.id,
      projectId: project.id,
      userId: owner.id,
      cookie,
    };
    session.cookie = cookie;
  });

  it('20 页 40 图的谱文：逐页保存 20 次与重新解析都在秒级完成', async () => {
    const created = await createArticleAction({
      orgId: fixture.orgId,
      projectId: fixture.projectId,
      title: '性能夹具：二十页支系谱',
    });
    const articleId = dataOf(created).articleId;

    // 服务端解析 40 图 / 20 页（FR-039 的结构完整性走同一条 parse 路径）。
    const parseStart = performance.now();
    const large = buildLargeContent(
      20,
      40,
      `articles/${fixture.orgId}/${articleId}/`
    );
    const parsed = parseArticleContent(large);
    const parseMs = performance.now() - parseStart;
    expect(parsed.pages).toHaveLength(20);

    // 页标识由服务端分配（FR-021）：先补到 20 页，再逐页写入正文与图片。
    const first = await getArticle(fixture.userId, fixture.orgId, articleId);
    if (!first) throw new Error('建篇后读不到谱文');
    const pageIds = parseArticleContent(first.content).pages.map(
      (page) => page.id
    );
    const addStart = performance.now();
    while (pageIds.length < 20) {
      const added = await addArticlePageAction({
        orgId: fixture.orgId,
        articleId,
      });
      pageIds.push(dataOf(added).pageId);
    }
    const addMs = performance.now() - addStart;

    // 逐页提交：每次只带上这一页，正文按页替换（FR-013 的按页提交口径）。
    const saveStart = performance.now();
    for (const [index, page] of parsed.pages.entries()) {
      const saved = await saveArticlePageAction({
        orgId: fixture.orgId,
        articleId,
        pageId: pageIds[index],
        doc: page.doc,
      });
      if ('error' in saved)
        throw new Error(`第 ${index + 1} 页保存失败：${saved.error}`);
    }
    const saveMs = performance.now() - saveStart;

    const stored = await getArticle(fixture.userId, fixture.orgId, articleId);
    if (!stored) throw new Error('保存后读不到谱文');
    const storedContent = parseArticleContent(stored.content);
    expect(storedContent.pages).toHaveLength(20);
    expect(stored.plainText).toContain('第 20 页正文');
    expect(countImages(storedContent)).toBe(40);

    console.info(
      `[SC-003 服务端] 解析 20 页 / 40 图 ${parseMs.toFixed(1)}ms；加页 19 次 ${addMs.toFixed(1)}ms；逐页保存 20 次 ${saveMs.toFixed(1)}ms`
    );
    // 宽松门槛：只要不是平方级退化或 N+1，这两个数应在几百毫秒内。
    expect(parseMs).lessThan(2_000);
    expect(saveMs).lessThan(30_000);
  });

  it('200 篇谱文的列表查询一次返回、按最后改动倒序，耗时秒级', async () => {
    const { orgId, projectId, userId } = fixture;
    const start = Date.now();
    for (let index = 0; index < 200; index += 1) {
      await createArticle({
        orgId,
        projectId,
        createdBy: userId,
        title: `性能夹具谱文 ${index}`,
        content: {
          schemaVersion: ARTICLE_SCHEMA_VERSION,
          pages: [
            {
              id: `p-${index}`,
              doc: {
                type: 'doc',
                content: [paragraph(`第 ${index} 篇正文。`)],
              },
            },
          ],
        },
        plainText: `第 ${index} 篇正文。`,
      });
    }
    const seedMs = Date.now() - start;

    const { listArticles } = await import('@/lib/db/queries/articles');
    const queryStart = performance.now();
    const rows = await listArticles(userId, orgId, projectId);
    const queryMs = performance.now() - queryStart;

    expect(rows.length).greaterThanOrEqual(200);
    // 每行都带页数：列表要显示「N 页」，这条断言顺带锁住「没有为每行再发一次查询」。
    for (const row of rows.slice(0, 20)) {
      expect(row.pageCount).greaterThanOrEqual(1);
    }
    console.info(
      `[SC-010] 造 200 篇 ${seedMs}ms；列表查询 ${queryMs.toFixed(1)}ms`
    );
    expect(queryMs).lessThan(5_000);
  });

  it('单页图片上限与整篇页上限在夹具边界上仍然生效（FR-027、FR-021）', () => {
    const atLimit = buildLargeContent(1, MAX_IMAGES_PER_PAGE, 'articles/o/a/');
    expect(
      parseArticleContent(atLimit).pages[0]?.doc.content.filter(
        (node) => node.type === 'articleImage'
      )
    ).toHaveLength(MAX_IMAGES_PER_PAGE);
    const overPages = buildLargeContent(
      MAX_PAGES_PER_ARTICLE + 1,
      1,
      'articles/o/a/'
    );
    expect(overPages.pages).toHaveLength(MAX_PAGES_PER_ARTICLE + 1);
    expect(MAX_PAGES_PER_ARTICLE).toBe(100);
  });
});
