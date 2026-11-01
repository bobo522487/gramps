'use client';

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
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
    onSelect,
    onSelectSpouse,
    onContextMenu,
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
      onContextMenu={(event) => {
        if (onContextMenu(person.id, event.clientX, event.clientY)) {
          event.preventDefault();
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
