import { describe, expect, it } from 'vitest';
import {
  acceptInviteSchema,
  signInSchema,
  signUpSchema,
  updateAccountSchema,
} from '@/lib/auth/schemas';

describe('credential schema normalization', () => {
  it('trims and lowercases the email before validation', () => {
    const result = signInSchema.safeParse({
      email: '  Alice@Example.COM ',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    expect(result.data?.email).toBe('alice@example.com');

    const signUp = signUpSchema.safeParse({
      email: ' BOB@corp.example ',
      password: 'password123',
    });
    expect(signUp.data?.email).toBe('bob@corp.example');
  });

  it('rejects malformed emails with a friendly message', () => {
    const result = signInSchema.safeParse({
      email: 'not-an-email',
      password: 'password123',
    });
    expect(result.error?.issues[0].message).toBe('邮箱格式不正确');
  });

  it('enforces the same password bounds on both flows', () => {
    for (const schema of [signInSchema, signUpSchema]) {
      expect(
        schema.safeParse({ email: 'a@b.co', password: '123' }).error?.issues[0]
          .message
      ).toBe('密码至少需要 8 个字符');
      expect(
        schema.safeParse({ email: 'a@b.co', password: 'x'.repeat(101) }).success
      ).toBe(false);
    }
  });
});

describe('sign-up schema', () => {
  it('allows the name to be omitted', () => {
    const result = signUpSchema.safeParse({
      email: 'a@b.co',
      password: 'password123',
    });
    expect(result.success).toBe(true);
    expect(result.data?.name).toBeUndefined();
  });

  it('trims a provided display name', () => {
    const result = signUpSchema.safeParse({
      email: 'a@b.co',
      password: 'password123',
      name: '  小明  ',
    });
    expect(result.data?.name).toBe('小明');
  });
});

describe('invitation acceptance schema', () => {
  it('accepts a Better Auth invitation id', () => {
    const result = acceptInviteSchema.safeParse({
      invitationId: '0190a5b0-0000-7000-8000-000000000001',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a token or malformed id with a friendly message', () => {
    expect(
      acceptInviteSchema.safeParse({ invitationId: 'abc' }).error?.issues[0]
        .message
    ).toBe('邀请链接无效');
    expect(
      acceptInviteSchema.safeParse({ token: 'x'.repeat(32) }).success
    ).toBe(false);
  });
});

describe('account update schema', () => {
  it('only keeps the display name and drops the email field', () => {
    const result = updateAccountSchema.safeParse({
      name: '张三',
      email: 'zhang@example.com',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ name: '张三' });
    expect(result.data).not.toHaveProperty('email');
  });

  it('still requires a name', () => {
    expect(updateAccountSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});
