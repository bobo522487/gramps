'use client';

import { create } from 'zustand';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 420;
export const INSPECTOR_MIN_WIDTH = 320;
export const INSPECTOR_MAX_WIDTH = 520;

export type LineageWorkspaceView = 'canvas' | 'table';

export type LineageStore = {
  lineageId: string | null;
  view: LineageWorkspaceView;
  selectedNodeId: string | null;
  collapsedNodeIds: string[];
  canvasQuery: string;
  tableQuery: string;
  generationLimit: number;
  renderGenerationLimit: number;
  minimapVisible: boolean;
  notice: string | null;
  focus: { nodeId: string; nonce: number } | null;
  collapsedFolderIds: string[];
  sidebarWidth: number;
  inspectorWidth: number;
  initializeForLineage: (id: string) => void;
  setView: (view: LineageWorkspaceView) => void;
  setSelectedNode: (id: string | null) => void;
  toggleCollapse: (id: string) => void;
  clearCollapsed: () => void;
  setCanvasQuery: (query: string) => void;
  setTableQuery: (query: string) => void;
  setGenerationLimit: (limit: number) => void;
  setRenderGenerationLimit: (limit: number) => void;
  appendGenerations: (step: number, maxGeneration: number) => void;
  setMinimapVisible: (visible: boolean) => void;
  setNotice: (notice: string | null) => void;
  requestFocus: (nodeId: string) => void;
  toggleFolder: (id: string) => void;
  setSidebarWidth: (width: number) => void;
  setInspectorWidth: (width: number) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export const initialLineageState = {
  lineageId: null as string | null,
  view: 'canvas' as LineageWorkspaceView,
  selectedNodeId: null as string | null,
  collapsedNodeIds: [] as string[],
  canvasQuery: '',
  tableQuery: '',
  generationLimit: 0,
  renderGenerationLimit: 0,
  minimapVisible: false,
  notice: null as string | null,
  focus: null as { nodeId: string; nonce: number } | null,
  collapsedFolderIds: [] as string[],
  sidebarWidth: 260,
  inspectorWidth: 360,
};

export const useLineageStore = create<LineageStore>((set) => ({
  ...initialLineageState,
  initializeForLineage: (id) =>
    set((state) =>
      state.lineageId === id
        ? {}
        : {
            lineageId: id,
            selectedNodeId: null,
            collapsedNodeIds: [],
            canvasQuery: '',
            tableQuery: '',
            generationLimit: 0,
            renderGenerationLimit: 0,
            notice: null,
            focus: null,
          }
    ),
  setView: (view) => set({ view }),
  setSelectedNode: (id) => set({ selectedNodeId: id }),
  toggleCollapse: (id) =>
    set((state) => ({
      collapsedNodeIds: state.collapsedNodeIds.includes(id)
        ? state.collapsedNodeIds.filter((value) => value !== id)
        : [...state.collapsedNodeIds, id],
    })),
  clearCollapsed: () => set({ collapsedNodeIds: [] }),
  setCanvasQuery: (query) => set({ canvasQuery: query }),
  setTableQuery: (query) => set({ tableQuery: query }),
  setGenerationLimit: (limit) =>
    set({ generationLimit: Math.max(0, Math.trunc(limit)) }),
  setRenderGenerationLimit: (limit) =>
    set({ renderGenerationLimit: Math.max(0, Math.trunc(limit)) }),
  appendGenerations: (step, maxGeneration) =>
    set((state) => ({
      renderGenerationLimit: Math.min(
        Math.max(state.renderGenerationLimit, 0) + step,
        Math.max(maxGeneration, 0)
      ),
    })),
  setMinimapVisible: (visible) => set({ minimapVisible: visible }),
  setNotice: (notice) => set({ notice }),
  requestFocus: (nodeId) =>
    set((state) => ({
      focus: { nodeId, nonce: (state.focus?.nonce ?? 0) + 1 },
    })),
  toggleFolder: (id) =>
    set((state) => ({
      collapsedFolderIds: state.collapsedFolderIds.includes(id)
        ? state.collapsedFolderIds.filter((value) => value !== id)
        : [...state.collapsedFolderIds, id],
    })),
  setSidebarWidth: (width) =>
    set({ sidebarWidth: clamp(width, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH) }),
  setInspectorWidth: (width) =>
    set({
      inspectorWidth: clamp(width, INSPECTOR_MIN_WIDTH, INSPECTOR_MAX_WIDTH),
    }),
}));
