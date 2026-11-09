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

export {
  countImages,
  derivePlainText,
  eachImageAttrs,
  imageWidthOf,
  isReferenced,
  mediaPathPrefix,
  pageHasImage,
  pagePlainText,
} from '@/lib/article/doc-view';
