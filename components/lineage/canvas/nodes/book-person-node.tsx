'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Heart,
  Plus,
  Trash2,
} from 'lucide-react';
import { memo } from 'react';
import type { BookPersonFlowNode } from '@/components/lineage/canvas/types';
import { displayGivenName } from '@/components/lineage/derived';

function spouseLabel(spouses: BookPersonFlowNode['data']['spouses']) {
  const first = spouses[0];
  if (!first) {
    return '';
  }
  const name = `${first.surname}${displayGivenName(first)}`;
  return spouses.length > 1 ? `${name} 等${spouses.length}人` : name;
}

export const BookPersonNode = memo(function BookPersonNode({
  data,
}: NodeProps<BookPersonFlowNode>) {
  const {
    person,
    spouses,
    rank,
    word,
    descendantCount,
    childCount,
    hasChildren,
    isCollapsed,
    isSelected,
    canWrite,
    onSelect,
    onSelectSpouse,
    onAddChild,
    onAddSpouse,
    onEdit,
    onDelete,
    onToggleCollapse,
  } = data;

  const isRoot = !person.parentId;
  const badge = word
    ? word
    : person.birthYear
      ? `${person.birthYear}`
      : childCount > 0
        ? `${childCount}子`
        : null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: React Flow nodes are divs managed by the canvas
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(person.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(person.id);
        }
      }}
      className={`group relative flex w-[112px] cursor-pointer select-none flex-col items-center justify-center rounded-md px-1 py-1 text-center transition-all duration-150 ${
        isSelected
          ? 'bg-primary/10 ring-2 ring-primary shadow-xs'
          : 'hover:bg-muted/60'
      }`}
    >
      {!isRoot && (
        <Handle
          type="target"
          position={Position.Left}
          id="parent-in-ltr"
          className="-left-1 !top-[14px] !h-2 !w-2 !border-2 !border-background !bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}

      <div className="flex w-full items-center justify-center gap-1.5">
        <span
          className={`shrink-0 transition-transform group-hover:scale-125 ${
            isRoot
              ? 'h-3.5 w-3.5 rounded-full border-2 border-primary bg-background shadow-xs'
              : 'h-2.5 w-2.5 rounded-full bg-primary'
          }`}
          title={isRoot ? '始祖' : `第 ${person.generation} 世`}
        />
        <span className="whitespace-nowrap font-serif text-sm font-bold tracking-widest text-foreground">
          {displayGivenName(person)}
        </span>
        {rank && !isRoot && (
          <span className="shrink-0 font-serif text-[10px] text-muted-foreground">
            {rank.replace(/[子女]$/, '')}
          </span>
        )}
      </div>

      <div className="mt-0.5 flex w-full items-center justify-center gap-1">
        {badge && (
          <span className="flex max-w-[64px] items-center gap-0.5 truncate rounded border border-border bg-card/90 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
            <BookOpen size={9} className="shrink-0" />
            <span className="truncate font-semibold">{badge}</span>
          </span>
        )}
        {hasChildren && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse(person.id);
            }}
            className={`nodrag nopan flex items-center gap-0.5 rounded border px-1 py-0.5 font-mono text-[9px] shadow-2xs transition-colors ${
              isCollapsed
                ? 'border-primary/30 bg-primary/15 font-bold text-primary'
                : 'border-border bg-muted text-muted-foreground hover:text-foreground'
            }`}
            title={
              isCollapsed
                ? `展开后代（${descendantCount} 人）`
                : `折叠后代（${descendantCount} 人）`
            }
          >
            {isCollapsed ? <ChevronRight size={9} /> : <ChevronLeft size={9} />}
            <span>{descendantCount}</span>
          </button>
        )}
      </div>

      {spouses.length > 0 && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onSelectSpouse(spouses[0].id);
          }}
          className="nodrag nopan mt-0.5 max-w-full truncate font-serif text-[10px] text-muted-foreground transition-colors hover:text-primary"
          title={`配偶：${spouses.map((spouse) => `${spouse.surname}${displayGivenName(spouse)}`).join('、')}`}
        >
          配 {spouseLabel(spouses)}
        </button>
      )}

      {canWrite && (
        <div
          className={`absolute -top-7 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-popover/95 px-1.5 py-0.5 text-popover-foreground shadow-md backdrop-blur transition-all ${
            isSelected
              ? 'scale-100 opacity-100'
              : 'pointer-events-none scale-95 opacity-0 group-hover:pointer-events-auto group-hover:scale-100 group-hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(person.id);
            }}
            title="添子女"
            aria-label="添子女"
            className="nodrag nopan flex items-center gap-0.5 rounded-full p-1 text-[10px] font-medium transition-colors hover:bg-muted"
          >
            <Plus size={10} /> 添子
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(person.id);
            }}
            title="编辑行传"
            aria-label="编辑行传"
            className="nodrag nopan flex items-center gap-0.5 rounded-full p-1 text-[10px] font-medium transition-colors hover:bg-muted"
          >
            <BookOpen size={10} /> 行传
          </button>

          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onAddSpouse(person.id);
            }}
            title="添配偶"
            aria-label="添配偶"
            className="nodrag nopan rounded-full p-1 text-accent-foreground transition-colors hover:bg-muted"
          >
            <Heart size={10} />
          </button>

          {!isRoot && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(person.id);
              }}
              title="删除"
              aria-label="删除"
              className="nodrag nopan rounded-full p-1 text-destructive transition-colors hover:bg-destructive/20"
            >
              <Trash2 size={10} />
            </button>
          )}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="child-out-ltr"
        className="-right-1 !top-[14px] !h-2 !w-2 !border-2 !border-background !bg-primary opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
});

BookPersonNode.displayName = 'BookPersonNode';
