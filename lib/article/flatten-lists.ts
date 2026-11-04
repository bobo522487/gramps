/**
 * 列表压平（FR-008 / FR-012）：003 只开放单层列表，但旧文档或粘贴内容可能带
 * 嵌套结构；落库前统一压平成单级，且必须保留全部文字。
 *
 * 单独成文件是为了让 `lib/article/doc.ts` 留在 F6 的 400 行预算内，同时让「嵌套
 * 提升为同级兄弟项」这条规则可以被独立单测覆盖。
 */

import type { ArticleNode } from '@/lib/article/doc';

/**
 * `<ul><li>a<ul><li>b</li></ul></li></ul>` → `<ul><li>a</li><li>b</li></ul>`：
 * 每个 listItem 自己的块（段落/标题/图片）单独成一项，其内部的嵌套列表被提升
 * 成同一级的兄弟项，文字不丢。
 */
export function flattenListItems(items: ArticleNode[]): ArticleNode[] {
  const result: ArticleNode[] = [];
  for (const item of items) {
    if (item.type !== 'listItem') {
      // 列表里出现非 listItem 的子节点（理论上不该有）：原样保留，交给白名单兜底。
      result.push(item);
      continue;
    }
    const children = item.content ?? [];
    const ownBlocks: ArticleNode[] = [];
    const nestedLists: ArticleNode[] = [];
    for (const child of children) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        nestedLists.push(child);
      } else {
        ownBlocks.push(child);
      }
    }
    // 只保留有自己的块内容的 listItem；纯嵌套（`<li><ul>…</ul></li>`）不产出
    // 空壳 bullet，其内部的嵌套列表已被提升为同级兄弟项（D4：避免空白项）。
    if (ownBlocks.length > 0) {
      result.push({ type: 'listItem', content: ownBlocks });
    }
    for (const nested of nestedLists) {
      result.push(...flattenListItems(nested.content ?? []));
    }
  }
  return result;
}
