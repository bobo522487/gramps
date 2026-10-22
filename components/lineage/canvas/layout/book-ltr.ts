import type { LineageIndex } from '../../derived';
import { generationWord, rankLabel } from '../../derived';
import type { NodeView } from '../../types';
import type {
  BookEdgeLayout,
  BookLayoutOptions,
  BookLayoutResult,
  BookPersonLayout,
  GenerationHeaderLayout,
} from './types';

export const BOOK_NODE_WIDTH = 112;
export const BOOK_HEADER_WIDTH = 84;
export const BOOK_COLUMN_WIDTH = 196;
export const BOOK_ROW_HEIGHT = 64;
export const BOOK_START_X = 60;
export const BOOK_START_Y = 110;

function buildHiddenIds(index: LineageIndex, collapsedIds: Set<string>) {
  const hidden = new Set<string>();

  const markDescendants = (nodeId: string) => {
    for (const child of index.childrenByParent.get(nodeId) ?? []) {
      if (hidden.has(child.id)) {
        continue;
      }
      hidden.add(child.id);
      for (const spouse of index.spousesByBlood.get(child.id) ?? []) {
        hidden.add(spouse.id);
      }
      markDescendants(child.id);
    }
  };

  for (const id of collapsedIds) {
    const person = index.byId.get(id);
    if (person?.role === 'blood') {
      markDescendants(id);
    }
  }
  return hidden;
}

export function layoutBookLtr(
  index: LineageIndex,
  options: BookLayoutOptions
): BookLayoutResult {
  const generationLimit =
    options.generationLimit > 0 ? options.generationLimit : index.maxGeneration;
  const hiddenIds = buildHiddenIds(index, options.collapsedIds);

  const visibleBlood = index.blood.filter(
    (person) =>
      person.generation <= generationLimit && !hiddenIds.has(person.id)
  );
  const visibleBloodIds = new Set(visibleBlood.map((person) => person.id));

  const roots = visibleBlood.filter(
    (person) => !person.parentId || !visibleBloodIds.has(person.parentId)
  );

  const positions = new Map<string, { x: number; y: number }>();
  let currentLeafY = BOOK_START_Y;

  const xForGeneration = (generation: number) =>
    BOOK_START_X +
    (generation - 1) * BOOK_COLUMN_WIDTH +
    BOOK_COLUMN_WIDTH / 2 -
    BOOK_NODE_WIDTH / 2;

  const layoutSubtree = (person: NodeView, assignedY: number) => {
    const x = xForGeneration(person.generation);
    positions.set(person.id, { x, y: assignedY });

    const isCollapsed = options.collapsedIds.has(person.id);
    const children = isCollapsed
      ? []
      : (index.childrenByParent.get(person.id) ?? []).filter((child) =>
          visibleBloodIds.has(child.id)
        );

    if (children.length === 0) {
      currentLeafY = Math.max(currentLeafY, assignedY + BOOK_ROW_HEIGHT);
      return;
    }

    children.forEach((child, childIndex) => {
      layoutSubtree(child, childIndex === 0 ? assignedY : currentLeafY);
    });
  };

  for (const root of roots) {
    layoutSubtree(root, currentLeafY);
    currentLeafY += 24;
  }

  for (const person of visibleBlood) {
    if (!positions.has(person.id)) {
      positions.set(person.id, {
        x: xForGeneration(person.generation),
        y: currentLeafY,
      });
      currentLeafY += BOOK_ROW_HEIGHT;
    }
  }

  const persons: BookPersonLayout[] = visibleBlood.map((person) => {
    const position = positions.get(person.id) ?? {
      x: xForGeneration(person.generation),
      y: BOOK_START_Y,
    };
    const childCount = index.childrenByParent.get(person.id)?.length ?? 0;
    return {
      id: person.id,
      person,
      spouses: index.spousesByBlood.get(person.id) ?? [],
      x: position.x,
      y: position.y,
      rank: rankLabel(index, person),
      word: generationWord(options.generationWords, person.generation),
      childCount,
      descendantCount: index.descendantCounts.get(person.id) ?? 0,
      hasChildren: childCount > 0,
      isCollapsed: options.collapsedIds.has(person.id),
    };
  });

  const maxVisibleGeneration = visibleBlood.reduce(
    (max, person) => Math.max(max, person.generation),
    0
  );

  const headers: GenerationHeaderLayout[] = [];
  for (
    let generation = 1;
    generation <= maxVisibleGeneration;
    generation += 1
  ) {
    const columnCenter =
      BOOK_START_X +
      (generation - 1) * BOOK_COLUMN_WIDTH +
      BOOK_COLUMN_WIDTH / 2;
    const generationBlood = visibleBlood.filter(
      (person) => person.generation === generation
    );
    const count = generationBlood.reduce(
      (total, person) =>
        total + 1 + (index.spousesByBlood.get(person.id)?.length ?? 0),
      0
    );
    headers.push({
      id: `generation-${generation}`,
      generation,
      x: columnCenter - BOOK_HEADER_WIDTH / 2,
      y: BOOK_START_Y - 56,
      count,
      word: generationWord(options.generationWords, generation),
    });
  }

  const edges: BookEdgeLayout[] = [];
  for (const person of visibleBlood) {
    if (person.parentId && visibleBloodIds.has(person.parentId)) {
      edges.push({
        id: `edge-${person.parentId}-${person.id}`,
        source: person.parentId,
        target: person.id,
      });
    }
  }

  const visibleIds = new Set(visibleBloodIds);
  for (const person of visibleBlood) {
    for (const spouse of index.spousesByBlood.get(person.id) ?? []) {
      visibleIds.add(spouse.id);
    }
  }

  return {
    persons,
    headers,
    edges,
    totalWidth: BOOK_START_X + maxVisibleGeneration * BOOK_COLUMN_WIDTH + 120,
    totalHeight: Math.max(currentLeafY + 100, BOOK_START_Y + 160),
    maxVisibleGeneration,
    visibleIds,
    hiddenIds,
  };
}
