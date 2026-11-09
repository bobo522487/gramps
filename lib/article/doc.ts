/**
 * 谱文分页文档的唯一实现处（ADR 0010：纯文本摘要只能由这里派生）。
 *
 * `article.body` 是分页文档包 `ArticleContent` 的**文本化序列化**
 * （`JSON.stringify`），落库为 `text`（data-model.md §8 #5）。读取时
 * `parseArticleContent` 把 `body` 解析回 `ArticleContent`。一篇谱文 = 一串页，
 * 每页装一个 ProseMirror 文档。页序就是数组顺序，没有独立的 sort 列
 * （data-model.md §2 不变量 4）。
 *
 * 这里的函数全是纯函数，不碰数据库、不碰 Next。
 */

import {
  ARTICLE_SCHEMA_VERSION,
  ARTICLE_TEXT_ALIGNMENTS,
  DEFAULT_ARTICLE_IMAGE_WIDTH,
  MEDIA_PATH_ROOT,
} from '@/lib/article/constants';
import { flattenListItems } from '@/lib/article/flatten-lists';

/** 节点上的标记（本期只允许 `textStyle`，白名单在 schemas.ts）。 */
export type ArticleMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

/** ProseMirror 节点的最小结构描述（不依赖编辑器类型，服务端也要能用）。 */
export type ArticleNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ArticleNode[];
  text?: string;
  marks?: ArticleMark[];
};

/** 一页的正文文档。 */
export type ArticlePageDoc = { type: 'doc'; content: ArticleNode[] };

/** 一页：稳定标识 + 正文文档。 */
export type ArticlePage = { id: string; doc: ArticlePageDoc };

/** `article.body` 的分页文档包（序列化进 `text` 列）。 */
export type ArticleContent = {
  schemaVersion: number;
  pages: ArticlePage[];
};

/** 正文里允许出现的节点类型（列表在编辑器 Word 化时放开）。 */
const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'articleImage',
  'bulletList',
  'orderedList',
  'listItem',
]);

/** 正文里允许出现的标记（FR-012 放开加粗/斜体/下划线；FR-031 仍禁颜色等）。 */
const ALLOWED_MARK_TYPES = new Set([
  'textStyle',
  'bold',
  'italic',
  'underline',
]);

/** 块级 `textAlign` 只允许 left/center/right（FR-009；justify 不在开放范围）。 */
const ALLOWED_TEXT_ALIGNMENTS = new Set<string>(ARTICLE_TEXT_ALIGNMENTS);

export function newArticlePageId(): string {
  return crypto.randomUUID();
}

export function createEmptyPageDoc(): ArticlePageDoc {
  return { type: 'doc', content: [] };
}

/** 新建谱文的初始内容：一页空文档。 */
export function createEmptyArticleContent(): ArticleContent {
  return {
    schemaVersion: ARTICLE_SCHEMA_VERSION,
    pages: [{ id: newArticlePageId(), doc: createEmptyPageDoc() }],
  };
}

/**
 * 把分页文档包序列化进 `article.body`（`text`）。落库前调用，读取端用
 * `parseArticleContent` 还原。空谱文也是一段合法 JSON（非空），满足
 * `ck_article_body` 的非空检查。
 */
export function serializeArticleContent(content: ArticleContent): string {
  return JSON.stringify(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 只设了字体没设字号时，ProseMirror 的 `Mark.toJSON()` 会把没设的那项写成
 * `null`（`attrsToJSON` 连默认值一起序列化）。白名单按「有值才算设置」判定，
 * 所以 null 在这里就剥掉——否则一用字体这一页就再也保存不上（FR-030）。
 */
function dropNullAttrs(
  attrs: Record<string, unknown>
): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) {
      kept[key] = value;
    }
  }
  return kept;
}

function keysOf(value: Record<string, unknown>): string[] {
  return Object.keys(value);
}

function sanitizeNode(value: unknown): ArticleNode | null {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null;
  }
  if (!ALLOWED_NODE_TYPES.has(value.type)) {
    // 白名单外的节点（表格、列表、脚注…）整节点丢弃，不保留空壳。
    return null;
  }
  if (value.type === 'articleImage') {
    const attrs = value.attrs;
    if (!isRecord(attrs) || typeof attrs.pathname !== 'string') {
      // 没有图片来源的图片节点渲染不出东西，也过不了白名单校验。整节点丢掉，
      // 别让它把这一页的保存请求毒死（FR-025、FR-031）。
      return null;
    }
  }
  const node: ArticleNode = { type: value.type };
  if (isRecord(value.attrs)) {
    // 必须重新装进普通对象：ProseMirror 的 attrsToJSON 用 Object.create(null)，
    // 而 React 的 Server Action 序列化只认带原型的普通对象——直接透传会让服务端
    // 收到一个没有 attrs 的节点（图片路径、标题层级就此丢失）。
    node.attrs = dropNullAttrs(value.attrs);
    // 与粘贴过滤器、zod 白名单同一口径：块的 textAlign 只能是
    // left/center/right；`justify` 及其他任何值在此直接丢弃（FR-009 / FR-031）。
    if (
      node.attrs &&
      'textAlign' in node.attrs &&
      !ALLOWED_TEXT_ALIGNMENTS.has(String(node.attrs.textAlign))
    ) {
      delete node.attrs.textAlign;
    }
  }
  if (typeof value.text === 'string') {
    node.text = value.text;
  }
  if (Array.isArray(value.marks)) {
    const marks = value.marks
      .filter(
        (mark): mark is ArticleMark =>
          isRecord(mark) &&
          typeof mark.type === 'string' &&
          ALLOWED_MARK_TYPES.has(mark.type)
      )
      .map((mark) =>
        isRecord(mark.attrs)
          ? { type: mark.type, attrs: dropNullAttrs(mark.attrs) }
          : { type: mark.type }
      )
      .filter(
        (mark) => mark.attrs === undefined || keysOf(mark.attrs).length > 0
      );
    if (marks.length > 0) {
      node.marks = marks;
    }
  }
  if (Array.isArray(value.content)) {
    const content = value.content
      .map(sanitizeNode)
      .filter((child): child is ArticleNode => child !== null);
    // 列表：把 sanitize 后的子项压平成单级（嵌套列表提升为同级兄弟项）。
    node.content =
      node.type === 'bulletList' || node.type === 'orderedList'
        ? flattenListItems(content)
        : content;
  }
  return node;
}

/**
 * 把任意来源的文档补成我们的形状。
 *
 * ProseMirror 的 `toJSON()` 在文档为空时**会省略 `content`**，服务端历史数据里
 * 也可能缺这个键；与其到处判空，不如在边界一次补齐：`content` 永远是数组，
 * 白名单外的节点一律丢掉。
 */
export function normalizePageDoc(value: unknown): ArticlePageDoc {
  const content =
    isRecord(value) && value.type === 'doc' && Array.isArray(value.content)
      ? value.content
      : [];
  return {
    type: 'doc',
    content: content
      .map(sanitizeNode)
      .filter((n): n is ArticleNode => n !== null),
  };
}

function sanitizePageDoc(value: unknown): ArticlePageDoc | null {
  if (!isRecord(value) || value.type !== 'doc') {
    return null;
  }
  return normalizePageDoc(value);
}

function sanitizePage(value: unknown): ArticlePage | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '') {
    return null;
  }
  const doc = sanitizePageDoc(value.doc);
  return doc ? { id: value.id, doc } : null;
}

/**
 * 把库里的 `body` 读成分页文档包。入参是 `article.body` 的序列化文本，也兼容
 * 已经解析过的 `ArticleContent` 对象（页级写入逻辑会就地构造后者再读回）。
 *
 * 读取路径 MUST NOT 抛错：`article` 表若有旧形状的行（本期功能未上线，理论上
 * 为 0 行），一律兜底成「一页空文档」并记日志，让用户能正常打开、下次保存即写
 * 成新结构（data-model.md §8）。白名单外的节点在这里被丢弃。
 */
export function parseArticleContent(value: unknown): ArticleContent {
  // `body` 落库为 `text`：先尝试按 JSON 解析序列化文本。
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value) as unknown;
    } catch {
      source = null;
    }
  }

  if (
    isRecord(source) &&
    source.schemaVersion === ARTICLE_SCHEMA_VERSION &&
    Array.isArray(source.pages)
  ) {
    const pages = source.pages
      .map(sanitizePage)
      .filter((page): page is ArticlePage => page !== null);
    if (pages.length > 0) {
      return { schemaVersion: ARTICLE_SCHEMA_VERSION, pages };
    }
  }

  const fallback = createEmptyArticleContent();
  if (value !== null && value !== undefined) {
    // 只在真的读到过时形状内容时提示，新建谱文的第一次解析不刷屏。
    console.warn('[article] body 不是分页文档包，已兜底为一页空文档', {
      shape: typeof value,
    });
  }
  return fallback;
}

function collectBlockTexts(doc: ArticlePageDoc): string[] {
  const texts: string[] = [];
  for (const block of doc.content) {
    const buffer: string[] = [];
    const walk = (node: ArticleNode) => {
      if (node.type === 'text' && typeof node.text === 'string') {
        buffer.push(node.text);
        return;
      }
      // 图片不贡献文本。
      if (node.type === 'articleImage') {
        return;
      }
      for (const child of node.content ?? []) {
        walk(child);
      }
    };
    walk(block);
    const joined = buffer.join('');
    if (joined !== '') {
      texts.push(joined);
    }
  }
  return texts;
}

/** 该页是否含插图（空白页占位提示用，FR-021）。 */
export function pageHasImage(doc: ArticlePageDoc): boolean {
  return doc.content.some(
    (block) =>
      block.type === 'articleImage' ||
      (block.content ?? []).some((child) => child.type === 'articleImage')
  );
}

/**
 * 单页的文本摘要（页缩略图用，FR-021）。与 `derivePlainText` 同一套块级规则，
 * 只是范围限于一页：图片不贡献文本，所以新加的页摘要是空串，缩略图显示「空页」。
 */
export function pagePlainText(doc: ArticlePageDoc): string {
  return collectBlockTexts(doc).join('\n\n');
}

/** 派生 `article` 纯文本摘要：按页序收集文本，块与页之间统一以空行分隔（ADR 0010：纯文本只能由这里派生，不再落库）。 */
export function derivePlainText(content: ArticleContent): string {
  return content.pages.map((page) => pagePlainText(page.doc)).join('\n\n');
}

function countImagesInDoc(doc: ArticlePageDoc): number {
  let count = 0;
  const walk = (node: ArticleNode) => {
    if (node.type === 'articleImage') {
      count += 1;
      return;
    }
    for (const child of node.content ?? []) {
      walk(child);
    }
  };
  for (const root of doc.content) {
    walk(root);
  }
  return count;
}

/** 跨页统计插图数量（删除确认与「每页 6 张」校验都用它）。 */
export function countImages(content: ArticleContent): number {
  return content.pages.reduce(
    (sum, page) => sum + countImagesInDoc(page.doc),
    0
  );
}

/**
 * 该 pathname 是否还被文档引用着——删页/删篇之后能不能真的清掉字节
 * （同一张图可能被复制到多页）。
 */
export function isReferenced(
  pathname: string,
  content: ArticleContent
): boolean {
  const walk = (node: ArticleNode): boolean => {
    if (node.type === 'articleImage') {
      return node.attrs?.pathname === pathname;
    }
    return (node.content ?? []).some(walk);
  };
  return content.pages.some((page) => page.doc.content.some(walk));
}

/** 图片节点的显示宽度（缺省整宽，FR-026）。 */
export function imageWidthOf(node: ArticleNode): string {
  const width = node.attrs?.width;
  return typeof width === 'string' ? width : DEFAULT_ARTICLE_IMAGE_WIDTH;
}

/** 组织隔离的 pathname 前缀：`articles/<orgId>/<articleId>/`（FR-035）。 */
export function mediaPathPrefix(orgId: string, articleId: string): string {
  return `${MEDIA_PATH_ROOT}/${orgId}/${articleId}/`;
}

/**
 * 遍历分页文档包里所有图片节点的 attrs。入参故意放宽成 `unknown`：
 * 库里读出的行与 Zod 校验后的输出都能走同一个遍历器，不再写第二份。
 */
export function eachImageAttrs(
  value: unknown,
  visit: (attrs: Record<string, unknown>, pageId: string) => void
): void {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    return;
  }
  const walk = (node: unknown, pageId: string) => {
    if (!isRecord(node) || typeof node.type !== 'string') {
      return;
    }
    if (node.type === 'articleImage') {
      visit(isRecord(node.attrs) ? node.attrs : {}, pageId);
      return;
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        walk(child, pageId);
      }
    }
  };
  for (const page of value.pages) {
    if (!isRecord(page) || typeof page.id !== 'string') {
      continue;
    }
    const doc = isRecord(page.doc) ? page.doc : null;
    if (!doc || !Array.isArray(doc.content)) {
      continue;
    }
    for (const root of doc.content) {
      walk(root, page.id);
    }
  }
}
