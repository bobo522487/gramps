import type { ActionState } from '@/lib/auth/types';

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
