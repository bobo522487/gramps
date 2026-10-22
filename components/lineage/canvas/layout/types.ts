import type { LineageIndex } from '../../derived';
import type { NodeView } from '../../types';

export type BookLayoutOptions = {
  collapsedIds: Set<string>;
  generationLimit: number;
  generationWords: string[] | null;
};

export type BookPersonLayout = {
  id: string;
  person: NodeView;
  spouses: NodeView[];
  x: number;
  y: number;
  rank: string;
  word: string | null;
  childCount: number;
  descendantCount: number;
  hasChildren: boolean;
  isCollapsed: boolean;
};

export type GenerationHeaderLayout = {
  id: string;
  generation: number;
  x: number;
  y: number;
  count: number;
  word: string | null;
};

export type BookEdgeLayout = {
  id: string;
  source: string;
  target: string;
};

export type BookLayoutResult = {
  persons: BookPersonLayout[];
  headers: GenerationHeaderLayout[];
  edges: BookEdgeLayout[];
  totalWidth: number;
  totalHeight: number;
  maxVisibleGeneration: number;
  visibleIds: Set<string>;
  hiddenIds: Set<string>;
};

export type BookLayoutInput = {
  index: LineageIndex;
  options: BookLayoutOptions;
};
