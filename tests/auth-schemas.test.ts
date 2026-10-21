import { describe, expect, it } from 'vitest';
import { signInSchema, signUpSchema } from '@/lib/auth/schemas';

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
