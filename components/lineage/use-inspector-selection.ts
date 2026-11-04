'use client';

import { useCallback, useRef, useState } from 'react';
import { useLineageStore } from '@/components/lineage/lineage-store';

export type DiscardConfirm =
  | { kind: 'close' }
  | { kind: 'switch'; nodeId: string };

/**
 * Selection writes for the person inspector, with an optional dirty discard
 * confirm when closing the sheet or switching to another person.
 */
export function useInspectorSelection() {
  const setSelectedNodeRaw = useLineageStore((state) => state.setSelectedNode);
  const dirtyRef = useRef(false);
  const [discardConfirm, setDiscardConfirm] = useState<DiscardConfirm | null>(
    null
  );

  const markInspectorDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const requestSelectNode = useCallback(
    (nodeId: string | null) => {
      const currentId = useLineageStore.getState().selectedNodeId;
      if (dirtyRef.current && currentId && nodeId !== currentId) {
        setDiscardConfirm(
          nodeId === null ? { kind: 'close' } : { kind: 'switch', nodeId }
        );
        return;
      }
      setSelectedNodeRaw(nodeId);
    },
    [setSelectedNodeRaw]
  );

  const confirmDiscard = useCallback(() => {
    if (!discardConfirm) {
      return;
    }
    dirtyRef.current = false;
    if (discardConfirm.kind === 'close') {
      setSelectedNodeRaw(null);
    } else {
      setSelectedNodeRaw(discardConfirm.nodeId);
    }
    setDiscardConfirm(null);
  }, [discardConfirm, setSelectedNodeRaw]);

  const clearSelection = useCallback(() => {
    dirtyRef.current = false;
    setSelectedNodeRaw(null);
  }, [setSelectedNodeRaw]);

  return {
    markInspectorDirty,
    requestSelectNode,
    confirmDiscard,
    clearSelection,
    discardConfirm,
    setDiscardConfirm,
    setSelectedNodeRaw,
  };
}
