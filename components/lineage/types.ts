// Structural input types, not `@/lib/db/schema` imports: this module is pulled
// into client bundles, and Biome's noRestrictedImports forbids reaching into the
// database layer from here. Server rows satisfy these shapes structurally.

export type NodeView = {
  id: string;
  parentId: string | null;
  spouseOfId: string | null;
  role: string;
  depth: number;
  generation: number;
  sort: number;
  name: string;
  surname: string;
  fullName: string;
  sex: number;
  courtesy: string | null;
  namePrefix: string | null;
  isAlive: boolean;
  birthText: string | null;
  deathText: string | null;
  birthYear: number | null;
  deathYear: number | null;
  burialPlace: string | null;
  biography: string | null;
};

export type FolderOption = {
  id: string;
  name: string;
  parentId: string | null;
};

export type LineageListItem = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  region: string | null;
  nodeCount: number;
  folderId: string | null;
};

type NodeRow = {
  id: string;
  parentId: string | null;
  spouseOfId: string | null;
  role: string;
  depth: number;
  generation: number;
  sort: number;
  name: string;
  surname: string;
  fullName: string;
  sex: number;
  courtesy: string | null;
  namePrefix: string | null;
  isAlive: boolean;
  birthText: string | null;
  deathText: string | null;
  birthYear: number | null;
  deathYear: number | null;
  burialPlace: string | null;
  biography: string | null;
};

type FolderRow = { id: string; name: string; parentId: string | null };

type LineageRow = {
  id: string;
  name: string;
  surname: string;
  hallCode: string | null;
  region: string | null;
  nodeCount: number;
  folderId: string | null;
};

/**
 * The single narrowing boundary between a server row and what the client may
 * see. Listing fields here (rather than spreading the row) is what keeps
 * orgId / path / createdBy out of the browser.
 */
export function toNodeView(node: NodeRow): NodeView {
  return {
    id: node.id,
    parentId: node.parentId,
    spouseOfId: node.spouseOfId,
    role: node.role,
    depth: node.depth,
    generation: node.generation,
    sort: node.sort,
    name: node.name,
    surname: node.surname,
    fullName: node.fullName,
    sex: node.sex,
    courtesy: node.courtesy,
    namePrefix: node.namePrefix,
    isAlive: node.isAlive,
    birthText: node.birthText,
    deathText: node.deathText,
    birthYear: node.birthYear,
    deathYear: node.deathYear,
    burialPlace: node.burialPlace,
    biography: node.biography,
  };
}

export function toNodeViews(nodes: NodeRow[]): NodeView[] {
  return nodes.map(toNodeView);
}

export function toFolderOption(folder: FolderRow): FolderOption {
  return { id: folder.id, name: folder.name, parentId: folder.parentId };
}

export function toLineageListItem(lineage: LineageRow): LineageListItem {
  return {
    id: lineage.id,
    name: lineage.name,
    surname: lineage.surname,
    hallCode: lineage.hallCode,
    region: lineage.region,
    nodeCount: lineage.nodeCount,
    folderId: lineage.folderId,
  };
}

/** Depth-first options for a folder picker; orphans surface at the top level. */
export function folderOptions(folders: FolderOption[]) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const childrenByParent = new Map<string | null, FolderOption[]>();
  for (const folder of folders) {
    const parentId =
      folder.parentId && byId.has(folder.parentId) ? folder.parentId : null;
    const bucket = childrenByParent.get(parentId) ?? [];
    bucket.push(folder);
    childrenByParent.set(parentId, bucket);
  }

  const options: { id: string; label: string }[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      options.push({
        id: folder.id,
        label: `${'— '.repeat(depth)}${folder.name}`,
      });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);
  return options;
}
