import type { Edge, Node } from '@xyflow/react';
import type { NodeView } from '@/components/lineage/types';

export type BookPersonNodeData = {
  person: NodeView;
  spouses: NodeView[];
  rank: string;
  word: string | null;
  childCount: number;
  descendantCount: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  isSelected: boolean;
  canWrite: boolean;
  onSelect: (nodeId: string) => void;
  onSelectSpouse: (spouseId: string) => void;
  onAddChild: (nodeId: string) => void;
  onAddSpouse: (nodeId: string) => void;
  onEdit: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onToggleCollapse: (nodeId: string) => void;
};

export type BookPersonFlowNode = Node<BookPersonNodeData, 'bookPerson'>;

export type GenerationHeaderData = {
  generation: number;
  count: number;
  word: string | null;
};

export type GenerationHeaderFlowNode = Node<
  GenerationHeaderData,
  'generationHeader'
>;

export type LineageFlowNode = BookPersonFlowNode | GenerationHeaderFlowNode;

export type BookEdgeData = {
  relationship: 'bloodline';
};

export type LineageFlowEdge = Edge<BookEdgeData, 'bookGenealogy'>;
