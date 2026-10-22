import { beforeEach, describe, expect, it } from 'vitest';
import {
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  initialLineageState,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useLineageStore,
} from '@/components/lineage/lineage-store';

beforeEach(() => {
  useLineageStore.setState(initialLineageState);
});

describe('lineage workspace store', () => {
  it('resets per-lineage UI state when switching lineages', () => {
    const store = useLineageStore.getState();
    store.initializeForLineage('lineage-a');
    store.setSelectedNode('node-1');
    store.toggleCollapse('node-2');
    store.setCanvasQuery('元英');
    store.setTableQuery('长房');
    store.setGenerationLimit(3);
    store.setRenderGenerationLimit(5);
    store.setNotice('提示');
    store.requestFocus('node-1');

    store.initializeForLineage('lineage-a');
    expect(useLineageStore.getState().selectedNodeId).toBe('node-1');

    store.initializeForLineage('lineage-b');
    const state = useLineageStore.getState();
    expect(state.lineageId).toBe('lineage-b');
    expect(state.selectedNodeId).toBeNull();
    expect(state.collapsedNodeIds).toEqual([]);
    expect(state.canvasQuery).toBe('');
    expect(state.tableQuery).toBe('');
    expect(state.generationLimit).toBe(0);
    expect(state.renderGenerationLimit).toBe(0);
    expect(state.notice).toBeNull();
    expect(state.focus).toBeNull();
  });

  it('toggles node and folder collapse independently', () => {
    const store = useLineageStore.getState();
    store.toggleCollapse('a');
    store.toggleCollapse('b');
    expect(useLineageStore.getState().collapsedNodeIds).toEqual(['a', 'b']);
    store.toggleCollapse('a');
    expect(useLineageStore.getState().collapsedNodeIds).toEqual(['b']);
    store.clearCollapsed();
    expect(useLineageStore.getState().collapsedNodeIds).toEqual([]);

    store.toggleFolder('f1');
    expect(useLineageStore.getState().collapsedFolderIds).toEqual(['f1']);
    store.toggleFolder('f1');
    expect(useLineageStore.getState().collapsedFolderIds).toEqual([]);
  });

  it('appends generation windows without passing the maximum', () => {
    const store = useLineageStore.getState();
    store.setRenderGenerationLimit(4);
    store.appendGenerations(5, 12);
    expect(useLineageStore.getState().renderGenerationLimit).toBe(9);
    store.appendGenerations(5, 12);
    expect(useLineageStore.getState().renderGenerationLimit).toBe(12);
    store.appendGenerations(5, 12);
    expect(useLineageStore.getState().renderGenerationLimit).toBe(12);

    store.setGenerationLimit(-4);
    expect(useLineageStore.getState().generationLimit).toBe(0);
    store.setRenderGenerationLimit(3.9);
    expect(useLineageStore.getState().renderGenerationLimit).toBe(3);
  });

  it('clamps resizable panel widths to their ranges', () => {
    const store = useLineageStore.getState();
    store.setSidebarWidth(100);
    expect(useLineageStore.getState().sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    store.setSidebarWidth(9999);
    expect(useLineageStore.getState().sidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    store.setSidebarWidth(300);
    expect(useLineageStore.getState().sidebarWidth).toBe(300);

    store.setInspectorWidth(10);
    expect(useLineageStore.getState().inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);
    store.setInspectorWidth(9999);
    expect(useLineageStore.getState().inspectorWidth).toBe(INSPECTOR_MAX_WIDTH);
  });

  it('requests focus with an increasing nonce', () => {
    const store = useLineageStore.getState();
    store.requestFocus('node-1');
    expect(useLineageStore.getState().focus).toEqual({
      nodeId: 'node-1',
      nonce: 1,
    });
    store.requestFocus('node-2');
    expect(useLineageStore.getState().focus).toEqual({
      nodeId: 'node-2',
      nonce: 2,
    });
  });
});
