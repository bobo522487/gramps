// 结构性输入类型，不 import `@/lib/db/schema`：这些模块会进客户端 bundle，
// Biome 的 noRestrictedImports 禁止从这里够到数据库层。服务端行按结构满足即可
// （与 components/lineage/types.ts 同一做法）。

export type ArticleFolderNode = {
  id: string;
  name: string;
  /** 该分类下的谱文数（由服务端 SQL 现算）。 */
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
  /** 显示名。扁平单层没有层级，不带缩进前缀。 */
  label: string;
};

/** 「未分类」在前端用一个固定哨兵值表示，`null` 才是服务端的真值。 */
export const UNFILED_FOLDER_ID = '__unfiled__';

/** 扁平单层：按名称排序后直接出选项，不再有父子缩进。 */
export function folderPickerOptions(
  folders: ArticleFolderNode[]
): FolderPickerOption[] {
  return [...folders]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((folder) => ({ id: folder.id, label: folder.name }));
}

/**
 * 列表行上的分类名（FR-032：搜索命中要能看出所属分类，跨分类找文才不费劲）。
 *
 * `null` 是服务端的真值「没挂分类」；万一行里的 folderId 在本份分类里查不到
 * （分类刚被删除的极端时序），也按未分类显示，不显示空白。
 */
export function folderLabel(
  options: FolderPickerOption[],
  folderId: string | null
): string {
  if (!folderId || folderId === UNFILED_FOLDER_ID) {
    return '未分类';
  }
  return options.find((option) => option.id === folderId)?.label ?? '未分类';
}

/** 渲染分类列表用：扁平单层，按名称排序。 */
export function sortedFolders(
  folders: ArticleFolderNode[]
): ArticleFolderNode[] {
  return [...folders].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}
