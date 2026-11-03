'use client';

import { Panel } from '@xyflow/react';
import {
  Filter,
  Map as MapIcon,
  MoreHorizontal,
  Plus,
  Printer,
  RotateCcw,
  Search,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function CanvasToolbar({
  personQuery,
  onPersonQueryChange,
  onLocate,
  generationLimit,
  maxGeneration,
  onGenerationChange,
  minimapVisible,
  onToggleMinimap,
  onFitView,
  onPrint,
  canWrite,
  onCreatePerson,
}: {
  personQuery: string;
  onPersonQueryChange: (query: string) => void;
  onLocate: () => void;
  generationLimit: number;
  maxGeneration: number;
  onGenerationChange: (value: number) => void;
  minimapVisible: boolean;
  onToggleMinimap: () => void;
  onFitView: () => void;
  onPrint: () => void;
  canWrite: boolean;
  onCreatePerson: () => void;
}) {
  return (
    <Panel position="top-right" className="z-30 m-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onLocate();
          }}
          className="relative w-36 md:w-44"
        >
          <Search
            size={12}
            className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={personQuery}
            onChange={(event) => onPersonQueryChange(event.target.value)}
            placeholder="搜族人定位..."
            aria-label="搜索族人定位"
            className="w-full rounded-lg border border-border bg-card/90 py-1 pr-2.5 pl-7 font-serif text-xs outline-none backdrop-blur transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </form>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-1 font-serif text-xs text-muted-foreground shadow-xs backdrop-blur">
          <Filter size={12} className="text-primary" />
          <select
            value={generationLimit}
            onChange={(event) => onGenerationChange(Number(event.target.value))}
            className="cursor-pointer border-none bg-transparent font-serif text-xs font-medium text-foreground outline-none"
            aria-label="世代筛选"
          >
            <option value={0}>全部世代（共 {maxGeneration} 世）</option>
            {Array.from({ length: maxGeneration }, (_, i) => i + 1).map(
              (generation) => (
                <option key={generation} value={generation}>
                  前 {generation} 世
                </option>
              )
            )}
          </select>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card/90 text-muted-foreground shadow-xs backdrop-blur transition-colors hover:text-foreground"
              title="更多"
              aria-label="更多画布工具"
            >
              <MoreHorizontal size={13} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" size="sm">
            <DropdownMenuItem onSelect={onFitView}>
              <RotateCcw size={12} /> 居中重置
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onPrint}>
              <Printer size={12} /> 打印世系表
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleMinimap}>
              <MapIcon size={12} />
              {minimapVisible ? '隐藏小地图' : '显示小地图'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {canWrite ? (
          <button
            type="button"
            onClick={onCreatePerson}
            className="flex h-8 items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 text-xs font-medium text-primary shadow-xs transition-colors hover:bg-primary/20"
            title="新增族人"
          >
            <Plus size={12} /> 新增族人
          </button>
        ) : null}
      </div>
    </Panel>
  );
}
