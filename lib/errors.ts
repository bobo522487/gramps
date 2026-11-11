import type { ActionState } from '@/lib/auth/types';

/** 组织已归档：页面入口由 notClosed 过滤，写事务统一返回该原因。 */
export const ORG_ARCHIVED_MESSAGE = '组织已归档，无法继续操作。';

export type ActionErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION'
  | 'RATE_LIMITED'
  | 'INTERNAL';

/** Builds an ActionState error with a stable machine-readable code. */
export function actionError(
  code: ActionErrorCode,
  message: string,
  extra?: Omit<ActionState, 'error' | 'success' | 'code'>
): ActionState {
  return { ...extra, error: message, code };
}
