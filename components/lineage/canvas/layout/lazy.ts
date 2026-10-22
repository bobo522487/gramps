export const LAZY_NODE_THRESHOLD = 500;
export const LAZY_GENERATION_STEP = 5;

export function initialRenderLimit(
  totalNodes: number,
  maxGeneration: number
): number {
  if (maxGeneration <= 0) {
    return 0;
  }
  return totalNodes > LAZY_NODE_THRESHOLD
    ? Math.min(LAZY_GENERATION_STEP, maxGeneration)
    : maxGeneration;
}

export function nextRenderLimit(
  current: number,
  maxGeneration: number,
  step = LAZY_GENERATION_STEP
): number {
  return Math.min(Math.max(current, 0) + step, Math.max(maxGeneration, 0));
}

export function shouldAppendGenerations({
  viewport,
  viewportWidth,
  totalWidth,
  zoom,
  generationLimit,
  renderGenerationLimit,
  maxGeneration,
}: {
  viewport: { x: number };
  viewportWidth: number;
  totalWidth: number;
  zoom: number;
  generationLimit: number;
  renderGenerationLimit: number;
  maxGeneration: number;
}): boolean {
  if (generationLimit > 0) {
    return false;
  }
  if (renderGenerationLimit >= maxGeneration) {
    return false;
  }
  if (renderGenerationLimit <= 0 || viewportWidth <= 0 || zoom <= 0) {
    return false;
  }

  const visibleFlowWidth = viewportWidth / zoom;
  if (totalWidth <= visibleFlowWidth) {
    return false;
  }

  const rightFlowEdge = (viewportWidth - viewport.x) / zoom;
  return rightFlowEdge >= totalWidth * 0.75;
}
