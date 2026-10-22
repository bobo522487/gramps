export type TreeFolderInput = {
  id: string;
  name: string;
  parentId: string | null;
};

export type TreeLineageInput = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  nodeCount: number;
  folderId: string | null;
};

export type LineageTreeLineage = {
  kind: 'lineage';
  lineage: TreeLineageInput;
};

export type LineageTreeFolder = {
  kind: 'folder';
  folder: TreeFolderInput;
  depth: number;
  children: LineageTreeFolder[];
  lineages: LineageTreeLineage[];
  lineageCount: number;
};

export type LineageTree = {
  folders: LineageTreeFolder[];
  unfiled: LineageTreeLineage[];
  lineageCount: number;
};

function childrenByParent(folders: TreeFolderInput[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const buckets = new Map<string | null, TreeFolderInput[]>();
  for (const folder of folders) {
    const parentId =
      folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const bucket = buckets.get(parentId) ?? [];
    bucket.push(folder);
    buckets.set(parentId, bucket);
  }
  return buckets;
}

export function folderLineageCount(folder: LineageTreeFolder): number {
  return folder.lineageCount;
}

export function buildLineageTree(
  folders: TreeFolderInput[],
  lineages: TreeLineageInput[]
): LineageTree {
  const buckets = childrenByParent(folders);
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

  function buildFolder(
    folder: TreeFolderInput,
    depth: number
  ): LineageTreeFolder {
    const children = (buckets.get(folder.id) ?? []).map((child) =>
      buildFolder(child, depth + 1)
    );
    const ownLineages = (lineagesByFolder.get(folder.id) ?? []).map(
      (lineage) => ({ kind: 'lineage' as const, lineage })
    );
    const lineageCount =
      ownLineages.length +
      children.reduce((total, child) => total + child.lineageCount, 0);
    return {
      kind: 'folder',
      folder,
      depth,
      children,
      lineages: ownLineages,
      lineageCount,
    };
  }

  const rootFolders = (buckets.get(null) ?? []).map((folder) =>
    buildFolder(folder, 0)
  );
  const unfiled = (lineagesByFolder.get(null) ?? []).map((lineage) => ({
    kind: 'lineage' as const,
    lineage,
  }));

  return {
    folders: rootFolders,
    unfiled,
    lineageCount: lineages.length,
  };
}

function lineageMatches(lineage: TreeLineageInput, needle: string) {
  return (
    lineage.name.toLowerCase().includes(needle) ||
    lineage.surname.toLowerCase().includes(needle) ||
    (lineage.hallCode ?? '').toLowerCase().includes(needle)
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

  function filterFolder(folder: LineageTreeFolder): LineageTreeFolder | null {
    if (folder.folder.name.toLowerCase().includes(needle)) {
      return folder;
    }
    const children = folder.children
      .map(filterFolder)
      .filter((child): child is LineageTreeFolder => Boolean(child));
    const lineages = folder.lineages.filter(({ lineage }) =>
      lineageMatches(lineage, needle)
    );
    if (children.length === 0 && lineages.length === 0) {
      return null;
    }
    return { ...folder, children, lineages };
  }

  return {
    folders: tree.folders
      .map(filterFolder)
      .filter((folder): folder is LineageTreeFolder => Boolean(folder)),
    unfiled: tree.unfiled.filter(({ lineage }) =>
      lineageMatches(lineage, needle)
    ),
    lineageCount: tree.lineageCount,
  };
}
