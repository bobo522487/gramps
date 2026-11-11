/**
 * 保存请求的等待上限与超时处理（FR-014）。
 *
 * 超时只影响顶栏提示，不取消底层请求：取消不了 Server Action，提前丢弃
 * in-flight 记录反而会让重试与旧请求并发写同一页。
 */
export const SAVE_DEADLINE_MS = 3000;

/** 超时哨兵：与 Action 的返回值区分开，不需要额外的异常类型。 */
const TIMED_OUT = Symbol('save-timeout');
export type SaveTimeout = typeof TIMED_OUT;

export function withDeadline<T>(
  task: Promise<T>,
  ms: number
): Promise<T | SaveTimeout> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(TIMED_OUT), ms);
    task.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(TIMED_OUT);
      }
    );
  });
}

export function saveErrorMessage(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'error' in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
  }
  return '操作没有保存成功，请重试。';
}

export { TIMED_OUT };
