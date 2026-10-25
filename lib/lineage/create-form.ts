type FolderLike = { id: string };

/**
 * 弹窗打开期间分类可能被删掉，选中值必须对着当前列表再校验一次，
 * 否则会静默提交空串、让谱系落到「默认分类」。
 */
export function resolveSelectedFolderId(
  folders: FolderLike[],
  selectedId: string
): string {
  return folders.some((folder) => folder.id === selectedId) ? selectedId : '';
}

export function hasInheritedSurname(surname: string): boolean {
  return surname.trim().length > 0;
}

export function canSubmitLineage({
  name,
  region,
  folderId,
}: {
  name: string;
  region: string;
  folderId: string;
}): boolean {
  return (
    name.trim().length > 0 && region.trim().length > 0 && folderId.length > 0
  );
}
