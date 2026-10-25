/**
 * 空谱系是否应该自动弹出「录入始祖」。
 *
 * 只在「本次进入该谱系后还没弹过」且「谱系确实没有人丁」且「用户能写」时弹一次，
 * 避免每次渲染都打扰用户，也避免给只读用户弹一个无法提交的表单。
 */
export function shouldAutoOpenRoot({
  nodeCount,
  alreadyOpened,
  canWrite,
}: {
  nodeCount: number;
  alreadyOpened: boolean;
  canWrite: boolean;
}): boolean {
  return nodeCount === 0 && !alreadyOpened && canWrite;
}
