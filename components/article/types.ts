// 结构性输入类型，不 import `@/lib/db/schema`：这些模块会进客户端 bundle，
// Biome 的 noRestrictedImports 禁止从这里够到数据库层。服务端行按结构满足即可
// （与 components/lineage/types.ts 同一做法）。

export type ArticleFolderNode = {
  id: string;
  name: string;
  parentId: string | null;
  /** 该分类下的谱文数（`folder.kind = 1`，由服务端 SQL 现算）。 */
  count: number;
};

export type ArticleRow = {
  id: string;
  title: string;
  folderId: string | null;
  pageCount: number;
  /** 最后改动时间；服务端从未更新过时回落到创建时间。 */
  lastTouchedAt: string;
};

export type FolderPickerOption = {
  id: string;
  /** 已带缩进的显示名，例如「谱序 / 旧谱序」。 */
  label: string;
};

/** 「未分类」在前端用一个固定哨兵值表示，`null` 才是服务端的真值。 */
export const UNFILED_FOLDER_ID = '__unfiled__';

export function folderPickerOptions(
  folders: ArticleFolderNode[]
): FolderPickerOption[] {
  const childrenOf = new Map<string | null, ArticleFolderNode[]>();
  for (const folder of folders) {
    const siblings = childrenOf.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenOf.set(folder.parentId, siblings);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  const options: FolderPickerOption[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of childrenOf.get(parentId) ?? []) {
      options.push({
        id: folder.id,
        label: `${'\u3000'.repeat(depth)}${folder.name}`,
      });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return options;
}

/**
 * 列表行上的分类名（FR-032：搜索命中要能看出所属分类，跨分类找文才不费劲）。
 *
 * `null` 是服务端的真值「没挂分类」；万一行里的 folderId 在本份分类里查不到
 * （分类刚被连带删除的极端时序），也按未分类显示，不显示空白。
 */
export function folderLabel(
  options: FolderPickerOption[],
  folderId: string | null
): string {
  if (!folderId || folderId === UNFILED_FOLDER_ID) {
    return '未分类';
  }
  const label = options.find((option) => option.id === folderId)?.label;
  return label ? label.replace(/\u3000/g, '') : '未分类';
}

/** 树的先序遍历（同样按名称排），供渲染分类树用。 */
export function folderTree(
  folders: ArticleFolderNode[]
): { folder: ArticleFolderNode; depth: number }[] {
  const childrenOf = new Map<string | null, ArticleFolderNode[]>();
  for (const folder of folders) {
    const siblings = childrenOf.get(folder.parentId) ?? [];
    siblings.push(folder);
    childrenOf.set(folder.parentId, siblings);
  }
  for (const list of childrenOf.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  const rows: { folder: ArticleFolderNode; depth: number }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of childrenOf.get(parentId) ?? []) {
      rows.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return rows;
}
