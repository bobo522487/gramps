import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';
import {
  AUTH_ERROR_MESSAGES,
  authErrorMessage,
  isAuthErrorCode,
  isSlugConflict,
  mapAuthError,
} from '@/lib/auth/errors';
import { isUniqueViolation } from '@/lib/db/errors';

type ApiStatus = ConstructorParameters<typeof APIError>[0];

function apiError(status: ApiStatus, code?: string) {
  return new APIError(status, {
    message: `better-auth says ${code ?? status}`,
    ...(code ? { code } : {}),
  });
}

describe('auth error messages', () => {
  it.each([
    ['INVALID_EMAIL_OR_PASSWORD', '邮箱或密码不正确，请重试。'],
    ['INVALID_PASSWORD', '当前密码不正确。'],
    ['USER_ALREADY_EXISTS', '该邮箱已被注册，请直接登录。'],
    ['INVITATION_NOT_FOUND', '邀请无效或已过期。'],
    ['FAILED_TO_RETRIEVE_INVITATION', '邀请无效或已过期。'],
    [
      'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION',
      '该邀请不属于当前登录账号。',
    ],
    ['USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION', '该用户已是组织成员。'],
    ['USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION', '已向该邮箱发出邀请。'],
    ['YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER', '你没有执行该操作的权限。'],
  ])('maps %s to a Chinese message', (code, message) => {
    expect(AUTH_ERROR_MESSAGES[code]).toBe(message);
    expect(authErrorMessage(apiError(400, code))).toBe(message);
  });

  it('maps any YOU_ARE_NOT_ALLOWED code to the permission message', () => {
    expect(
      authErrorMessage(apiError(403, 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS'))
    ).toBe('你没有执行该操作的权限。');
  });

  it('falls back to the HTTP status when Better Auth has no known code', () => {
    expect(authErrorMessage(apiError(401))).toBe(
      '登录状态已失效，请重新登录。'
    );
    expect(authErrorMessage(apiError(403))).toBe('你没有执行该操作的权限。');
    expect(authErrorMessage(apiError(404))).toBe('请求的资源不存在。');
    expect(authErrorMessage(apiError(409))).toBe('数据冲突，请刷新后重试。');
    expect(authErrorMessage(apiError(429))).toBe('操作过于频繁，请稍后再试。');
  });

  it('maps the archived-organization trigger to a Chinese message', () => {
    const error = Object.assign(new Error('org_archived'), { code: 'P0001' });
    expect(authErrorMessage(error)).toBe('组织已归档，无法继续操作。');
  });

  it('never leaks SQL or stack details for unknown errors', () => {
    const error = new Error(
      'insert into "auth"."users" ("email") values ($1) - duplicate key'
    );
    const message = authErrorMessage(error);
    expect(message).toBe('操作失败，请稍后重试。');
    expect(message).not.toMatch(/insert|auth\.users|duplicate|SQL/i);
  });
});

describe('mapAuthError', () => {
  it('returns a stable ActionState code with the Chinese message', () => {
    expect(mapAuthError(apiError(401, 'INVALID_EMAIL_OR_PASSWORD'))).toEqual({
      error: '邮箱或密码不正确，请重试。',
      code: 'UNAUTHORIZED',
    });
    expect(mapAuthError(apiError(403))).toEqual({
      error: '你没有执行该操作的权限。',
      code: 'FORBIDDEN',
    });
    expect(mapAuthError(new Error('boom'))).toEqual({
      error: '操作失败，请稍后重试。',
      code: 'INTERNAL',
    });
  });

  it('maps the last-owner trigger to a conflict without SQL text', () => {
    const error = Object.assign(
      new Error('last_owner: cannot remove the last owner'),
      { code: 'P0001' }
    );
    expect(mapAuthError(error)).toEqual({
      error: '不能移除或降级最后一个所有者。',
      code: 'CONFLICT',
    });
  });
});

describe('isAuthErrorCode', () => {
  it('matches a Better Auth body code', () => {
    expect(
      isAuthErrorCode(
        apiError(400, 'USER_ALREADY_EXISTS'),
        'USER_ALREADY_EXISTS'
      )
    ).toBe(true);
    expect(
      isAuthErrorCode(
        apiError(400, 'USER_ALREADY_EXISTS'),
        'INVITATION_NOT_FOUND'
      )
    ).toBe(false);
    expect(isAuthErrorCode(null, 'USER_ALREADY_EXISTS')).toBe(false);
  });
});

describe('isSlugConflict', () => {
  it('recognizes Better Auth slug conflicts and raw unique violations', () => {
    expect(isSlugConflict(apiError(400, 'ORGANIZATION_ALREADY_EXISTS'))).toBe(
      true
    );
    expect(
      isSlugConflict(
        Object.assign(new Error('duplicate key'), { code: '23505' })
      )
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isSlugConflict(apiError(400, 'INVITATION_NOT_FOUND'))).toBe(false);
    expect(isSlugConflict(null)).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  it('finds a 23505 buried in Better Auth and Drizzle causes', () => {
    const driverError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    const drizzleError = new Error('query failed', { cause: driverError });
    const wrapped = new APIError(500, {
      message: 'internal',
      cause: drizzleError,
    });

    expect(isUniqueViolation(wrapped)).toBe(true);
    expect(isUniqueViolation(drizzleError)).toBe(true);
    expect(isUniqueViolation(driverError)).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(apiError(500))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
