'use client';

import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import type { GenerationHeaderFlowNode } from '@/components/lineage/canvas/types';

export const GenerationHeaderNode = memo(function GenerationHeaderNode({
  data,
}: NodeProps<GenerationHeaderFlowNode>) {
  const { generation, count, word } = data;

  return (
    <div
      className="group flex w-[84px] cursor-default select-none flex-col items-center justify-center"
      title={`第 ${generation} 世（共 ${count} 人）`}
    >
      <div className="flex w-full flex-col items-center justify-center rounded-md border border-border bg-card px-3 py-1 font-serif shadow-xs transition-transform group-hover:scale-105 group-hover:border-primary/50">
        <span className="text-xs font-bold tracking-wider text-foreground">
          {generation}世
        </span>
        <span className="text-[9px] font-normal text-muted-foreground">
          {count} 人{word ? ` · ${word}` : ''}
        </span>
      </div>
      <div className="mt-1 h-3 w-[1.5px] bg-primary/60" />
    </div>
  );
});

GenerationHeaderNode.displayName = 'GenerationHeaderNode';
