// Structural input types, not `@/lib/db/schema` imports: this module is pulled
// into client bundles, and Biome's noRestrictedImports forbids reaching into the
// database layer from here. Server rows satisfy these shapes structurally.

export type NodeView = {
  id: string;
  parentId: string | null;
  spouseOfId: string | null;
  role: string;
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

type FolderRow = { id: string; name: string };

/**
 * The target-model `lineage` has no surname / hall code / region / node count
 * columns. The list item still exposes them because the shell renders them;
 * they are optional on the way in and `toLineageListItem` supplies neutral
 * values. This keeps the UI contract stable without reintroducing the columns.
 */
type LineageRow = {
  id: string;
  name: string;
  folderId: string | null;
  surname?: string | null;
  hallCode?: string | null;
  region?: string | null;
  nodeCount?: number | null;
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
  return { id: folder.id, name: folder.name };
}

export function toLineageListItem(lineage: LineageRow): LineageListItem {
  return {
    id: lineage.id,
    name: lineage.name,
    surname: lineage.surname ?? '',
    hallCode: lineage.hallCode ?? null,
    region: lineage.region ?? null,
    nodeCount: lineage.nodeCount ?? 0,
    folderId: lineage.folderId,
  };
}

/** 扁平单层：按名称排序后的选项列表，没有父子缩进。 */
export function folderOptions(folders: FolderOption[]) {
  return [...folders]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((folder) => ({ id: folder.id, label: folder.name }));
}
