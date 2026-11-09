import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import postgres from 'postgres';

import { resolveE2ETestDatabaseUrl } from '../env';

/**
 * 谱文性能夹具（SC-003 的浏览器那一半，T048）。
 *
 * `tests/integration/article-perf.test.ts` 量的是服务端（解析 + 逐页落库 + 列表查询），
 * 这里负责把同一份形状灌进 E2E 测试库，让规约能量**切页耗时与滚动帧率**。
 *
 * 只用裸 SQL + 文件系统，不 import 应用模块：Playwright 的测试进程没有 Next 的
 * 运行期别名与配置装配，硬拉进来会把环境问题当成产品失败。
 */

/** 1×1 透明 PNG，够让图片真的走一遍读取代理。 */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

/** 文档节点的形状只用于让 `sql.json()` 收到可序列化的字面量类型。 */
type TextNode = { type: 'text'; text: string };
type BlockNode =
  | { type: 'heading'; attrs: { level: number }; content: TextNode[] }
  | { type: 'paragraph'; content: TextNode[] }
  | { type: 'articleImage'; attrs: { pathname: string; width: string } };
type SeedPage = { id: string; doc: { type: 'doc'; content: BlockNode[] } };

export type SeededArticle = {
  articleId: string;
  pathname: string;
  pageCount: number;
  imageCount: number;
};

export type SeedOptions = {
  /** 按 URL 里的 20 位公开 ID 反查 project，避免把 UUID 传来传去。 */
  projectRef: string;
  pageCount?: number;
  imagesPerPage?: number;
  title?: string;
};

/**
 * 往 E2E 测试库里灌一篇「N 页 × 每页 M 图」的谱文，并把图片字节写进本地兜底媒体目录。
 *
 * 返回的 `pathname` 前缀就是这些字节的落点，测试结束不用管：`globalSetup` 每轮重建库，
 * `.data/media/` 也已 gitignore。
 */
export async function seedArticleWithImages(
  options: SeedOptions
): Promise<SeededArticle> {
  const pageCount = options.pageCount ?? 20;
  const imagesPerPage = options.imagesPerPage ?? 2;
  const sql = postgres(resolveE2ETestDatabaseUrl(), { max: 1 });
  try {
    const [project] = await sql`
      select id, organization_id, created_by
      from project
      where ref = ${options.projectRef}
      limit 1
    `;
    if (!project) {
      throw new Error(`E2E 夹具找不到云谱空间：${options.projectRef}`);
    }
    const [created] = await sql`
      insert into article (organization_id, project_id, title, body)
      values (${project.organization_id}, ${project.id}, ${options.title ?? '性能夹具谱文'}, ${JSON.stringify({ schemaVersion: 1, pages: [] })})
      returning id
    `;
    const articleId: string = created.id;
    const prefix = `articles/${project.organization_id}/${articleId}`;

    const pages: SeedPage[] = [];
    const texts: string[] = [];
    let imageCount = 0;
    for (let page = 0; page < pageCount; page += 1) {
      const content: BlockNode[] = [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: `第 ${page + 1} 房支系` }],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: `第 ${page + 1} 页正文：始祖讳元，宋末自闽徙居，其后分房，子孙各占一世。`.repeat(
                6
              ),
            },
          ],
        },
      ];
      for (let slot = 0; slot < imagesPerPage; slot += 1, imageCount += 1) {
        const pathname = `${prefix}/${randomUUID()}.png`;
        content.push({
          type: 'articleImage',
          attrs: { pathname, width: slot % 2 === 0 ? 'full' : 'medium' },
        });
      }
      pages.push({ id: randomUUID(), doc: { type: 'doc', content } });
      texts.push(`第 ${page + 1} 页正文片段`);
    }

    const content = { schemaVersion: 1, pages };
    await sql`
      update article
      set body = ${JSON.stringify(content)}
      where id = ${articleId}
    `;

    // 图片字节落进 fs 兜底驱动（本地与 CI 都没有 BLOB_READ_WRITE_TOKEN）。
    const mediaRoot = path.resolve(process.cwd(), '.data', 'media');
    await mkdir(path.join(mediaRoot, prefix), { recursive: true });
    for (const page of pages) {
      const doc = (
        page as { doc: { content: { attrs?: { pathname?: string } }[] } }
      ).doc;
      for (const node of doc.content) {
        if (node.attrs?.pathname) {
          await writeFile(path.join(mediaRoot, node.attrs.pathname), PNG_1PX);
        }
      }
    }

    return { articleId, pathname: prefix, pageCount, imageCount };
  } finally {
    await sql.end({ timeout: 1 });
  }
}
