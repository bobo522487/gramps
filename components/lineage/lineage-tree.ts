export type TreeFolderInput = {
  id: string;
  name: string;
};

export type TreeLineageInput = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  region: string | null;
  nodeCount: number;
  folderId: string | null;
};

export type LineageTreeLineage = {
  kind: 'lineage';
  lineage: TreeLineageInput;
};

/**
 * 扁平单层（附录 A.2）：分类没有父子关系，树退化成「一层分类 + 每个分类下的谱系」。
 * `depth` / `children` 一并退役——留着它们只会让 UI 以为还能建子分类。
 */
export type LineageTreeFolder = {
  kind: 'folder';
  folder: TreeFolderInput;
  lineages: LineageTreeLineage[];
  lineageCount: number;
};

export type LineageTree = {
  folders: LineageTreeFolder[];
  unfiled: LineageTreeLineage[];
  lineageCount: number;
};

export function folderLineageCount(folder: LineageTreeFolder): number {
  return folder.lineageCount;
}

export function buildLineageTree(
  folders: TreeFolderInput[],
  lineages: TreeLineageInput[]
): LineageTree {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const lineagesByFolder = new Map<string | null, TreeLineageInput[]>();
  for (const lineage of lineages) {
    const folderId =
      lineage.folderId && folderIds.has(lineage.folderId)
        ? lineage.folderId
        : null;
    const bucket = lineagesByFolder.get(folderId) ?? [];
    bucket.push(lineage);
    lineagesByFolder.set(folderId, bucket);
  }

  const sorted = [...folders].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN')
  );

  const treeFolders: LineageTreeFolder[] = sorted.map((folder) => {
    const own = (lineagesByFolder.get(folder.id) ?? []).map((lineage) => ({
      kind: 'lineage' as const,
      lineage,
    }));
    return {
      kind: 'folder',
      folder,
      lineages: own,
      lineageCount: own.length,
    };
  });

  const unfiled = (lineagesByFolder.get(null) ?? []).map((lineage) => ({
    kind: 'lineage' as const,
    lineage,
  }));

  return {
    folders: treeFolders,
    unfiled,
    lineageCount: lineages.length,
  };
}

function lineageMatches(lineage: TreeLineageInput, needle: string) {
  return (
    lineage.name.toLowerCase().includes(needle) ||
    lineage.surname.toLowerCase().includes(needle) ||
    (lineage.hallCode ?? '').toLowerCase().includes(needle) ||
    (lineage.region ?? '').toLowerCase().includes(needle)
  );
}

export function filterLineageTree(
  tree: LineageTree,
  query: string
): LineageTree {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return tree;
  }

  const folders = tree.folders
    .map((folder) => {
      const lineages = folder.lineages.filter(({ lineage }) =>
        lineageMatches(lineage, needle)
      );
      const hit = folder.folder.name.toLowerCase().includes(needle);
      if (!hit && lineages.length === 0) {
        return null;
      }
      return { ...folder, lineages, lineageCount: lineages.length };
    })
    .filter((folder): folder is LineageTreeFolder => Boolean(folder));

  return {
    folders,
    unfiled: tree.unfiled.filter(({ lineage }) =>
      lineageMatches(lineage, needle)
    ),
    lineageCount: tree.lineageCount,
  };
}
