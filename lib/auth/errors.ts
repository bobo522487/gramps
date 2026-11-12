import type { ActionState } from '@/lib/auth/types';
import {
  CONFLICT_MESSAGE,
  FALLBACK_MESSAGE,
  isUniqueViolation,
  LAST_OWNER_MESSAGE,
  PERMISSION_MESSAGE,
  pgErrorOf,
} from '@/lib/db/errors';
import type { ActionErrorCode } from '@/lib/errors';

export const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: '邮箱或密码不正确，请重试。',
  INVALID_PASSWORD: '当前密码不正确。',
  USER_ALREADY_EXISTS: '该邮箱已被注册，请直接登录。',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: '该邮箱已被注册，请直接登录。',
  INVITATION_NOT_FOUND: '邀请无效或已过期。',
  FAILED_TO_RETRIEVE_INVITATION: '邀请无效或已过期。',
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION: '邀请无效或已过期。',
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: '该邀请不属于当前登录账号。',
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: '该用户已是组织成员。',
  MEMBER_ALREADY_EXISTS: '该用户已是组织成员。',
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: '已向该邮箱发出邀请。',
  INVITATION_ALREADY_EXISTS: '已向该邮箱发出邀请。',
  ORGANIZATION_NOT_FOUND: '组织不存在或你没有访问权限。',
  ORGANIZATION_SLUG_ALREADY_TAKEN: '组织标识已被使用，请重试。',
  ORGANIZATION_ALREADY_EXISTS: '组织已存在。',
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: LAST_OWNER_MESSAGE,
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: LAST_OWNER_MESSAGE,
  MEMBER_NOT_FOUND: '成员不存在或已被移除。',
  ROLE_NOT_FOUND: '角色不存在。',
  YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER: PERMISSION_MESSAGE,
};

const STATUS_MESSAGES: Record<
  number,
  { message: string; code: ActionErrorCode }
> = {
  401: { message: '登录状态已失效，请重新登录。', code: 'UNAUTHORIZED' },
  403: { message: PERMISSION_MESSAGE, code: 'FORBIDDEN' },
  404: { message: '请求的资源不存在。', code: 'NOT_FOUND' },
  409: { message: CONFLICT_MESSAGE, code: 'CONFLICT' },
  422: { message: '提交的数据有误，请检查后重试。', code: 'VALIDATION' },
  429: { message: '操作过于频繁，请稍后再试。', code: 'RATE_LIMITED' },
};

function errorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const value = error as { statusCode?: unknown; status?: unknown };
  if (typeof value.statusCode === 'number') {
    return value.statusCode;
  }
  return typeof value.status === 'number' ? value.status : null;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const body = (error as { body?: unknown }).body;
  if (typeof body === 'object' && body !== null) {
    const code = (body as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function statusCode(status: number): ActionErrorCode {
  return STATUS_MESSAGES[status]?.code ?? 'INTERNAL';
}

/**
 * Translates Better Auth and database failures into a safe Chinese message.
 * SQL text, stacks and driver details never reach the browser.
 */
export function authErrorMessage(error: unknown): string {
  const pg = pgErrorOf(error);
  if (pg) {
    return pg.message;
  }

  const code = errorCode(error);
  if (code && AUTH_ERROR_MESSAGES[code]) {
    return AUTH_ERROR_MESSAGES[code];
  }
  if (code?.startsWith('YOU_ARE_NOT_ALLOWED')) {
    return PERMISSION_MESSAGE;
  }

  const status = errorStatus(error);
  if (status !== null) {
    return STATUS_MESSAGES[status]?.message ?? FALLBACK_MESSAGE;
  }

  if (isUniqueViolation(error)) {
    return CONFLICT_MESSAGE;
  }

  return FALLBACK_MESSAGE;
}

export function mapAuthError(error: unknown): ActionState {
  const pg = pgErrorOf(error);
  if (pg) {
    return { error: pg.message, code: pg.code };
  }

  const status = errorStatus(error);
  if (status !== null) {
    return { error: authErrorMessage(error), code: statusCode(status) };
  }

  if (isUniqueViolation(error)) {
    return { error: CONFLICT_MESSAGE, code: 'CONFLICT' };
  }

  return { error: FALLBACK_MESSAGE, code: 'INTERNAL' };
}

export function isAuthErrorCode(error: unknown, code: string): boolean {
  return errorCode(error) === code;
}

/** Safe structured fields for server logs; never includes SQL or credentials. */
export function authErrorDetails(error: unknown): {
  code: string | null;
  status: number | null;
} {
  return { code: errorCode(error), status: errorStatus(error) };
}

/** Slug collisions surface as either a Better Auth code or a raw unique index. */
export function isSlugConflict(error: unknown): boolean {
  return (
    isAuthErrorCode(error, 'ORGANIZATION_ALREADY_EXISTS') ||
    isUniqueViolation(error)
  );
}
