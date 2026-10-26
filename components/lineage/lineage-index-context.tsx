'use client';

import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { buildLineageIndex, type LineageIndex } from './derived';

export type { LineageIndex };

import type { NodeView } from './types';

const LineageIndexContext = createContext<LineageIndex | null>(null);

/**
 * Builds the lineage index once per render tree. The canvas, the inspector, the
 * create dialog and the detail table all need it; building it in each of them
 * meant four independent Map constructions over the same node array.
 */
export function LineageIndexProvider({
  nodes,
  build = buildLineageIndex,
  children,
}: {
  nodes: NodeView[];
  build?: (nodes: NodeView[]) => LineageIndex;
  children: ReactNode;
}) {
  const index = useMemo(() => build(nodes), [build, nodes]);
  return (
    <LineageIndexContext.Provider value={index}>
      {children}
    </LineageIndexContext.Provider>
  );
}

/**
 * Throws instead of returning an empty index: a silently empty tree is far
 * harder to diagnose than a stack trace naming the missing provider.
 */
export function useLineageIndex(): LineageIndex {
  const index = useContext(LineageIndexContext);
  if (!index) {
    throw new Error('useLineageIndex must be used inside LineageIndexProvider');
  }
  return index;
}
