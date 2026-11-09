/**
 * 谱文分页文档的只读派生：纯文本摘要、插图计数、图片引用与遍历。
 *
 * 从 `doc.ts` 拆出以满足 F6 单文件 ≤400 行的约束：这一组函数只依赖文档类型
 * 与 `constants.ts`，不参与 `body` 的解析/清洗，因此可以独立成模块。
 * 对外仍从 `@/lib/article/doc` 重导出，调用方不用改。
 */

import {
  DEFAULT_ARTICLE_IMAGE_WIDTH,
  MEDIA_PATH_ROOT,
} from '@/lib/article/constants';
import type {
  ArticleContent,
  ArticleNode,
  ArticlePageDoc,
} from '@/lib/article/doc';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
