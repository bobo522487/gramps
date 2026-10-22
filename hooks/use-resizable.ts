'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type UseResizableOptions = {
  value: number;
  minWidth: number;
  maxWidth: number;
  edge: 'left' | 'right';
  onChange: (width: number) => void;
  leftOffset?: number | (() => number);
};

export function useResizable({
  value,
  minWidth,
  maxWidth,
  edge,
  onChange,
  leftOffset = 0,
}: UseResizableOptions) {
  const [isResizing, setIsResizing] = useState(false);
  const latest = useRef({ edge, onChange, minWidth, maxWidth, leftOffset });
  latest.current = { edge, onChange, minWidth, maxWidth, leftOffset };

  const startResizing = useCallback(() => setIsResizing(true), []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMove = (event: MouseEvent) => {
      const current = latest.current;
      const offset =
        typeof current.leftOffset === 'function'
          ? current.leftOffset()
          : current.leftOffset;
      const raw =
        current.edge === 'left'
          ? event.clientX - offset
          : document.body.clientWidth - event.clientX;
      current.onChange(
        Math.min(Math.max(raw, current.minWidth), current.maxWidth)
      );
    };

    const handleUp = () => setIsResizing(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return { width: value, isResizing, startResizing };
}
