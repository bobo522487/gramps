import { describe, expect, it } from 'vitest';
import {
  signInSchema,
  signUpSchema,
  updateAccountSchema,
} from '@/lib/auth/schemas';
import { acceptInviteSchema } from '@/lib/org/schemas';
import {
  createProjectSchema,
  updateProjectSchema,
} from '@/lib/project/schemas';

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

  it('keeps required and invalid-type email messages distinct', () => {
    expect(
      signInSchema.safeParse({ password: 'password123' }).error?.issues[0]
        .message
    ).toBe('请输入邮箱');
    expect(
      signInSchema.safeParse({ email: 123, password: 'password123' }).error
        ?.issues[0].message
    ).toBe('邮箱格式不正确');
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
  it('accepts a 43-char base64url token', () => {
    // 32 字节随机值的 base64url 是 43 个字符，不是 uuid。
    const result = acceptInviteSchema.safeParse({
      token: 'A'.repeat(43),
    });
    expect(result.success).toBe(true);
  });

  it('rejects anything too short or too long with a friendly message', () => {
    // 太短：不是合法 token，且留一条 1 字符就能打到数据库的口子没有意义。
    expect(
      acceptInviteSchema.safeParse({ token: 'abc' }).error?.issues[0].message
    ).toBe('邀请链接无效');
    // 太长：上限 128，超出直接拒，避免灌大字符串进 sha256。
    expect(
      acceptInviteSchema.safeParse({ token: 'x'.repeat(200) }).success
    ).toBe(false);
  });

  it('rejects the old uuid-shaped payload field name', () => {
    // 字段名从 invitationId 改成 token。只改值不改名的话，表单会静默传空，
    // 表现成「链接无效」——一条与真实原因无关的报错。
    expect(
      acceptInviteSchema.safeParse({
        invitationId: '0190a5b0-0000-7000-8000-000000000001',
      }).success
    ).toBe(false);
  });

  it('trims surrounding whitespace before validating', () => {
    // 邮件客户端会在链接两端加空格或换行。
    const result = acceptInviteSchema.safeParse({
      token: '  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA  ',
    });
    expect(result.success).toBe(true);
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

const PROJECT_ORG_ID = '0190a5b0-0000-7000-8000-000000000001';
const PROJECT_ID = '0190a5b0-0000-7000-8000-000000000002';
const validProject = {
  orgId: PROJECT_ORG_ID,
  name: '义门陈氏云谱',
  surname: '陈',
  themeName: '义门陈氏宗谱',
  countriesRegions: '中国江西',
};

describe('project create schema', () => {
  it('applies defaults and coerces rating/notes', () => {
    expect(createProjectSchema.parse(validProject)).toMatchObject({
      status: 'in_progress',
      importance: 1,
    });
    expect(
      createProjectSchema.parse({
        ...validProject,
        status: 'planning',
        importance: '3',
        notes: '  始修于光绪年间  ',
      })
    ).toMatchObject({
      status: 'planning',
      importance: 3,
      notes: '始修于光绪年间',
    });
  });

  it('enforces the 24-character name boundary', () => {
    expect(
      createProjectSchema.safeParse({ ...validProject, name: '谱'.repeat(24) })
        .success
    ).toBe(true);
    expect(
      createProjectSchema.safeParse({ ...validProject, name: '谱'.repeat(25) })
        .error?.issues[0].message
    ).toBe('项目名不能超过 24 个字符');
  });

  it('rejects whitespace-only required fields', () => {
    const cases = [
      ['name', '请输入项目名'],
      ['surname', '请输入姓氏'],
      ['countriesRegions', '请输入地区'],
      ['themeName', '请输入主题名'],
    ] as const;
    for (const [field, message] of cases) {
      expect(
        createProjectSchema.safeParse({ ...validProject, [field]: '   ' }).error
          ?.issues[0].message
      ).toBe(message);
    }
  });

  it('rejects invalid rating, unknown status and overlong notes', () => {
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: '0' }).error
        ?.issues[0].message
    ).toBe('重要等级最低为 1 星');
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: '6' }).error
        ?.issues[0].message
    ).toBe('重要等级最高为 5 星');
    expect(
      createProjectSchema.safeParse({ ...validProject, importance: 'abc' })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({ ...validProject, status: 'archived' })
        .success
    ).toBe(false);
    expect(
      createProjectSchema.safeParse({
        ...validProject,
        notes: '注'.repeat(501),
      }).success
    ).toBe(false);
  });
});

describe('project update schema', () => {
  it('drops immutable fields and accepts mutable metadata', () => {
    const result = updateProjectSchema.parse({
      orgId: PROJECT_ORG_ID,
      projectId: PROJECT_ID,
      name: '新项目名',
      themeName: '李氏宗谱',
      surname: '李',
      status: 'completed',
      importance: '5',
    });

    expect(result).not.toHaveProperty('themeName');
    expect(result).not.toHaveProperty('surname');
    expect(result).toMatchObject({
      name: '新项目名',
      status: 'completed',
      importance: 5,
    });
  });

  it('enforces the name boundary and turns empty notes into null', () => {
    expect(
      updateProjectSchema.safeParse({
        orgId: PROJECT_ORG_ID,
        projectId: PROJECT_ID,
        name: '谱'.repeat(25),
      }).error?.issues[0].message
    ).toBe('项目名不能超过 24 个字符');
    expect(
      updateProjectSchema.parse({
        orgId: PROJECT_ORG_ID,
        projectId: PROJECT_ID,
        notes: '',
      }).notes
    ).toBeNull();
  });
});
