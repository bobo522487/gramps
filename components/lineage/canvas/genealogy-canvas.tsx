'use client';

import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import { BookOpen, GripHorizontal, Plus, User, Users, X } from 'lucide-react';
import { type DragEvent, useCallback, useEffect, useMemo, useRef } from 'react';
import '@/components/lineage/canvas/canvas.css';
import { CanvasToolbar } from '@/components/lineage/canvas/canvas-toolbar';
import { BookGenealogyEdge } from '@/components/lineage/canvas/edges/book-genealogy-edge';
import {
  BOOK_COLUMN_WIDTH,
  BOOK_NODE_WIDTH,
  BOOK_START_X,
  layoutBookLtr,
} from '@/components/lineage/canvas/layout/book-ltr';
import {
  initialRenderLimit,
  LAZY_GENERATION_STEP,
  nextRenderLimit,
  shouldAppendGenerations,
} from '@/components/lineage/canvas/layout/lazy';
import { BookPersonNode } from '@/components/lineage/canvas/nodes/book-person-node';
import { GenerationHeaderNode } from '@/components/lineage/canvas/nodes/generation-header-node';
import type {
  LineageFlowEdge,
  LineageFlowNode,
} from '@/components/lineage/canvas/types';
import {
  ancestorsOf,
  isDescendant,
  matchLineagePerson,
} from '@/components/lineage/derived';
import { useLineageIndex } from '@/components/lineage/lineage-index-context';
import { useLineageStore } from '@/components/lineage/lineage-store';

const nodeTypes = {
  bookPerson: BookPersonNode,
  generationHeader: GenerationHeaderNode,
};

const edgeTypes = {
  bookGenealogy: BookGenealogyEdge,
};

const TEMPLATE_MIME = 'application/genealogy-template';

type DragTemplate = {
  sex: 'male' | 'female';
};

export type GenealogyCanvasProps = {
  lineageId: string;
  generationWords: string[] | null;
  canWrite: boolean;
  onCreateChild: (parentId: string) => void;
  onCreateSpouse: (bloodId: string) => void;
  onCreatePerson: () => void;
  onSelectNode: (nodeId: string | null) => void;
  onEditNode: (nodeId: string) => void;
  onNodeContextMenu: (nodeId: string, x: number, y: number) => boolean;
  onMoveNode: (nodeId: string, newParentId: string) => void;
  onPrint: () => void;
};

function CanvasInner({
  lineageId,
  generationWords,
  canWrite,
  onCreateChild,
  onCreateSpouse,
  onCreatePerson,
  onSelectNode,
  onEditNode,
  onNodeContextMenu,
  onMoveNode,
  onPrint,
}: GenealogyCanvasProps) {
  const { fitView, getViewport, screenToFlowPosition, setCenter } =
    useReactFlow();
  const containerRef = useRef<HTMLDivElement>(null);
  const handledFocus = useRef(0);
  const fittedKey = useRef('');
  const matchCursorRef = useRef(0);
  const lastMatchQueryRef = useRef('');

  const selectedNodeId = useLineageStore((state) => state.selectedNodeId);
  const collapsedNodeIds = useLineageStore((state) => state.collapsedNodeIds);
  const toggleCollapse = useLineageStore((state) => state.toggleCollapse);
  const personQuery = useLineageStore((state) => state.personQuery);
  const setPersonQuery = useLineageStore((state) => state.setPersonQuery);
  const generationLimit = useLineageStore((state) => state.generationLimit);
  const setGenerationLimit = useLineageStore(
    (state) => state.setGenerationLimit
  );
  const renderGenerationLimit = useLineageStore(
    (state) => state.renderGenerationLimit
  );
  const setRenderGenerationLimit = useLineageStore(
    (state) => state.setRenderGenerationLimit
  );
  const appendGenerations = useLineageStore((state) => state.appendGenerations);
  const minimapVisible = useLineageStore((state) => state.minimapVisible);
  const setMinimapVisible = useLineageStore((state) => state.setMinimapVisible);
  const notice = useLineageStore((state) => state.notice);
  const setNotice = useLineageStore((state) => state.setNotice);
  const focus = useLineageStore((state) => state.focus);
  const requestFocus = useLineageStore((state) => state.requestFocus);

  const index = useLineageIndex();
  const collapsedSet = useMemo(
    () => new Set(collapsedNodeIds),
    [collapsedNodeIds]
  );
  const freshLimit = useMemo(
    () => initialRenderLimit(index.nodes.length, index.maxGeneration),
    [index.nodes.length, index.maxGeneration]
  );

  useEffect(() => {
    if (!focus) {
      handledFocus.current = 0;
    }
  }, [focus]);

  const lastMaxGeneration = useRef(index.maxGeneration);

  useEffect(() => {
    const previousMax = lastMaxGeneration.current;
    lastMaxGeneration.current = index.maxGeneration;

    if (renderGenerationLimit === 0 && index.maxGeneration > 0) {
      setRenderGenerationLimit(freshLimit);
    } else if (
      index.maxGeneration > previousMax &&
      renderGenerationLimit >= previousMax
    ) {
      // New generations were added while the whole tree was rendered (e.g. a
      // child was just created); keep the new node visible instead of hiding
      // it behind the lazy window until a reload.
      setRenderGenerationLimit(index.maxGeneration);
    } else if (renderGenerationLimit > index.maxGeneration) {
      setRenderGenerationLimit(index.maxGeneration);
    }
  }, [
    freshLimit,
    index.maxGeneration,
    renderGenerationLimit,
    setRenderGenerationLimit,
  ]);

  const windowLimit =
    renderGenerationLimit > 0
      ? Math.min(renderGenerationLimit, index.maxGeneration)
      : index.maxGeneration;
  const effectiveLimit =
    generationLimit > 0 ? Math.min(generationLimit, windowLimit) : windowLimit;

  const layout = useMemo(
    () =>
      layoutBookLtr(index, {
        collapsedIds: collapsedSet,
        generationLimit: effectiveLimit,
        generationWords,
      }),
    [index, collapsedSet, effectiveLimit, generationWords]
  );

  const handleSelect = useCallback(
    (nodeId: string) => onSelectNode(nodeId),
    [onSelectNode]
  );
  const handleSelectSpouse = useCallback(
    (spouseId: string) => onSelectNode(spouseId),
    [onSelectNode]
  );
  const handleToggleCollapse = useCallback(
    (nodeId: string) => toggleCollapse(nodeId),
    [toggleCollapse]
  );

  const computedNodes = useMemo<LineageFlowNode[]>(() => {
    const personNodes = layout.persons.map((person) => ({
      id: person.id,
      type: 'bookPerson' as const,
      position: { x: person.x, y: person.y },
      draggable: false,
      selectable: false,
      data: {
        person: person.person,
        spouses: person.spouses,
        rank: person.rank,
        word: person.word,
        childCount: person.childCount,
        descendantCount: person.descendantCount,
        hasChildren: person.hasChildren,
        isCollapsed: person.isCollapsed,
        isSelected: person.id === selectedNodeId,
        onSelect: handleSelect,
        onSelectSpouse: handleSelectSpouse,
        onContextMenu: onNodeContextMenu,
        onToggleCollapse: handleToggleCollapse,
      },
    }));

    const headerNodes = layout.headers.map((header) => ({
      id: header.id,
      type: 'generationHeader' as const,
      position: { x: header.x, y: header.y },
      draggable: false,
      selectable: false,
      data: {
        generation: header.generation,
        count: header.count,
        word: header.word,
      },
    }));

    return [...headerNodes, ...personNodes];
  }, [
    layout,
    selectedNodeId,
    handleSelect,
    handleSelectSpouse,
    onNodeContextMenu,
    handleToggleCollapse,
  ]);

  const computedEdges = useMemo<LineageFlowEdge[]>(
    () =>
      layout.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: 'child-out-ltr',
        targetHandle: 'parent-in-ltr',
        type: 'bookGenealogy' as const,
        selectable: false,
        data: { relationship: 'bloodline' as const },
      })),
    [layout.edges]
  );

  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<LineageFlowNode>(computedNodes);
  const [flowEdges, setFlowEdges, onEdgesChange] =
    useEdgesState<LineageFlowEdge>(computedEdges);

  useEffect(() => {
    setFlowNodes(computedNodes);
    setFlowEdges(computedEdges);
  }, [computedNodes, computedEdges, setFlowNodes, setFlowEdges]);

  useEffect(() => {
    const key = `${lineageId}:${generationLimit}`;
    if (fittedKey.current === key) {
      return;
    }
    const timer = window.setTimeout(() => {
      fittedKey.current = key;
      fitView({ padding: 0.15, duration: 300 });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [lineageId, generationLimit, fitView]);

  useEffect(() => {
    if (!focus || focus.nonce === handledFocus.current) {
      return;
    }
    const target = index.byId.get(focus.nodeId);
    if (!target) {
      return;
    }
    const bloodId =
      target.role === 'spouse' && target.spouseOfId
        ? target.spouseOfId
        : target.id;
    const placed = layout.persons.find((person) => person.id === bloodId);
    if (!placed) {
      return;
    }
    handledFocus.current = focus.nonce;
    setCenter(placed.x + BOOK_NODE_WIDTH / 2, placed.y + 24, {
      zoom: 1.1,
      duration: 500,
    });
  }, [focus, index, layout, setCenter]);

  const handleGenerationChange = useCallback(
    (value: number) => {
      setGenerationLimit(value);
      if (value > 0 && value > renderGenerationLimit) {
        setRenderGenerationLimit(Math.min(value, index.maxGeneration));
      }
    },
    [
      index.maxGeneration,
      renderGenerationLimit,
      setGenerationLimit,
      setRenderGenerationLimit,
    ]
  );

  const handleLocate = useCallback(() => {
    const query = personQuery;
    const normalized = query.trim();
    if (normalized !== lastMatchQueryRef.current) {
      matchCursorRef.current = 0;
      lastMatchQueryRef.current = normalized;
    } else {
      matchCursorRef.current += 1;
    }

    const match = matchLineagePerson(index, query, matchCursorRef.current);
    if (!match) {
      matchCursorRef.current = 0;
      setNotice('未找到匹配的族人，请换个关键字');
      return;
    }
    matchCursorRef.current = match.matchIndex;
    const blood = index.byId.get(match.bloodId);
    const matched = index.byId.get(match.matchedId);
    if (!blood || !matched) {
      setNotice('未找到匹配的族人，请换个关键字');
      return;
    }

    setGenerationLimit(0);
    setRenderGenerationLimit(
      Math.max(renderGenerationLimit, blood.generation, freshLimit)
    );
    const chain = [blood.id, ...ancestorsOf(index, blood.id)];
    for (const id of chain) {
      if (collapsedNodeIds.includes(id)) {
        toggleCollapse(id);
      }
    }
    onSelectNode(match.matchedId);
    requestFocus(match.matchedId);
    setNotice(
      match.count > 1
        ? `找到 ${match.count} 位匹配，第 ${match.matchIndex + 1} 位「${matched.fullName}」· 再按 Enter 下一个`
        : null
    );
  }, [
    collapsedNodeIds,
    freshLimit,
    index,
    onSelectNode,
    personQuery,
    renderGenerationLimit,
    requestFocus,
    setGenerationLimit,
    setNotice,
    setRenderGenerationLimit,
    toggleCollapse,
  ]);

  const handleMoveEnd = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const viewport = getViewport();
    if (
      shouldAppendGenerations({
        viewport,
        viewportWidth: container.clientWidth,
        totalWidth: layout.totalWidth,
        zoom: viewport.zoom,
        generationLimit,
        renderGenerationLimit: windowLimit,
        maxGeneration: index.maxGeneration,
      })
    ) {
      const next = nextRenderLimit(windowLimit, index.maxGeneration);
      if (next > windowLimit) {
        appendGenerations(LAZY_GENERATION_STEP, index.maxGeneration);
      }
    }
  }, [
    appendGenerations,
    generationLimit,
    getViewport,
    index.maxGeneration,
    layout.totalWidth,
    windowLimit,
  ]);

  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      if (!canWrite) {
        return false;
      }
      if (
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      ) {
        return false;
      }
      const source = index.byId.get(connection.source);
      const target = index.byId.get(connection.target);
      if (
        !source ||
        !target ||
        source.role !== 'blood' ||
        target.role !== 'blood'
      ) {
        return false;
      }
      if (target.parentId === null) {
        return false;
      }
      if (source.generation >= target.generation) {
        return false;
      }
      return !isDescendant(index, target.id, source.id);
    },
    [canWrite, index]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }
      onMoveNode(connection.target, connection.source);
    },
    [onMoveNode]
  );

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData(TEMPLATE_MIME);
      if (!raw) {
        return;
      }
      let template: DragTemplate;
      try {
        template = JSON.parse(raw) as DragTemplate;
      } catch {
        return;
      }
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const generation = Math.min(
        Math.max(
          Math.floor((position.x - BOOK_START_X) / BOOK_COLUMN_WIDTH) + 1,
          1
        ),
        index.maxGeneration
      );
      const candidates = layout.persons.filter(
        (person) => person.person.generation === generation
      );
      const pool = candidates.length > 0 ? candidates : layout.persons;
      let nearest = pool[0];
      let bestDistance = Number.POSITIVE_INFINITY;
      for (const person of pool) {
        const dx = person.x + BOOK_NODE_WIDTH / 2 - position.x;
        const dy = person.y + 24 - position.y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          nearest = person;
        }
      }
      if (!nearest) {
        return;
      }
      if (template.sex === 'female') {
        onCreateSpouse(nearest.id);
      } else {
        onCreateChild(nearest.id);
      }
    },
    [
      index.maxGeneration,
      layout.persons,
      onCreateChild,
      onCreateSpouse,
      screenToFlowPosition,
    ]
  );

  const maxGeneration = index.maxGeneration;
  const appendNext = useCallback(() => {
    appendGenerations(LAZY_GENERATION_STEP, maxGeneration);
  }, [appendGenerations, maxGeneration]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: React Flow owns the pointer interactions
    <div
      ref={containerRef}
      className="genealogy-canvas relative h-full w-full select-none overflow-hidden bg-background text-foreground"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(_, node) => {
          if (node.type === 'bookPerson') {
            onSelectNode(node.id);
          }
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'bookPerson') {
            onEditNode(node.id);
          }
        }}
        onPaneClick={() => onSelectNode(null)}
        onConnect={handleConnect}
        isValidConnection={isValidConnection}
        onMoveEnd={handleMoveEnd}
        nodesDraggable={false}
        nodesConnectable={canWrite}
        elementsSelectable={false}
        edgesFocusable={false}
        nodesFocusable={false}
        onlyRenderVisibleElements
        minZoom={0.2}
        maxZoom={2.8}
        defaultViewport={{ x: 60, y: 60, zoom: 0.9 }}
        className="touch-none bg-background"
      >
        <Background
          variant={BackgroundVariant.Lines}
          gap={140}
          size={1}
          color="hsl(var(--border))"
          className="opacity-70 dark:opacity-35"
        />

        <Controls showInteractive={false} position="bottom-left" />

        {minimapVisible && (
          <MiniMap
            position="bottom-right"
            pannable
            zoomable
            nodeColor={(node: Node) => {
              if (node.type === 'generationHeader') {
                return 'transparent';
              }
              if (node.id === selectedNodeId) {
                return 'hsl(var(--primary))';
              }
              return 'hsl(var(--muted-foreground) / 0.55)';
            }}
            nodeStrokeWidth={2}
            className="!h-32 !w-44"
          />
        )}

        <CanvasToolbar
          personQuery={personQuery}
          onPersonQueryChange={(query) => {
            lastMatchQueryRef.current = '';
            matchCursorRef.current = 0;
            setPersonQuery(query);
          }}
          onLocate={handleLocate}
          generationLimit={generationLimit}
          maxGeneration={maxGeneration}
          onGenerationChange={handleGenerationChange}
          minimapVisible={minimapVisible}
          onToggleMinimap={() => setMinimapVisible(!minimapVisible)}
          onFitView={() => fitView({ padding: 0.15, duration: 300 })}
          onPrint={onPrint}
          canWrite={canWrite}
          onCreatePerson={onCreatePerson}
        />

        {notice && (
          <Panel position="top-center" className="z-40 mt-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-popover/95 px-3 py-1.5 text-xs text-popover-foreground shadow-md backdrop-blur">
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                title="关闭提示"
                aria-label="关闭提示"
              >
                <X size={12} />
              </button>
            </div>
          </Panel>
        )}

        {canWrite && (
          <Panel
            position="bottom-right"
            className="m-3 mr-14 hidden flex-col gap-1 md:flex"
          >
            <div className="rounded-lg border border-border bg-card/90 p-2 font-serif shadow-sm backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between border-b border-border/50 pb-1 text-[11px] font-bold text-foreground">
                <span className="flex items-center gap-1">
                  <GripHorizontal size={11} className="text-primary" />
                  拖拽录入族人
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-only template tile */}
                <div
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      TEMPLATE_MIME,
                      JSON.stringify({ sex: 'male' } satisfies DragTemplate)
                    );
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="flex cursor-grab items-center gap-1.5 rounded border border-border/70 bg-muted/40 px-2 py-1 text-xs text-foreground transition-all hover:border-primary/50 hover:bg-muted active:cursor-grabbing"
                >
                  <User size={11} className="text-primary" />
                  <span>男丁</span>
                  <Plus size={10} className="text-muted-foreground" />
                </div>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: drag-only template tile */}
                <div
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(
                      TEMPLATE_MIME,
                      JSON.stringify({ sex: 'female' } satisfies DragTemplate)
                    );
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="flex cursor-grab items-center gap-1.5 rounded border border-border/70 bg-muted/40 px-2 py-1 text-xs text-foreground transition-all hover:border-primary/50 hover:bg-muted active:cursor-grabbing"
                >
                  <Users size={11} className="text-muted-foreground" />
                  <span>女眷</span>
                  <Plus size={10} className="text-muted-foreground" />
                </div>
              </div>
            </div>
          </Panel>
        )}

        <Panel position="bottom-center" className="z-20 mb-3">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/90 px-3 py-1 text-[11px] text-muted-foreground shadow-xs backdrop-blur">
            <BookOpen size={11} className="text-primary" />
            <span>
              已显示 1–{Math.max(effectiveLimit, 1)} 世 / 共 {maxGeneration} 世
            </span>
            {generationLimit > 0 ? (
              <span className="text-foreground">
                仅显示前 {generationLimit} 世
              </span>
            ) : (
              windowLimit < maxGeneration && (
                <button
                  type="button"
                  onClick={appendNext}
                  className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-medium text-primary transition-colors hover:bg-primary/20"
                >
                  加载后续 {LAZY_GENERATION_STEP} 世
                </button>
              )
            )}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function GenealogyCanvas(props: GenealogyCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
