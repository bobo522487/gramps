import { z } from 'zod';
import {
  DEFAULT_PROJECT_IMPORTANCE,
  DEFAULT_PROJECT_STATUS,
  MAX_PROJECT_NAME_LENGTH,
  MAX_PROJECT_NOTES_LENGTH,
  MAX_PROJECT_REGIONS_LENGTH,
  MAX_PROJECT_SURNAME_LENGTH,
  MAX_PROJECT_THEME_NAME_LENGTH,
  PROJECT_IMPORTANCE_MAX,
  PROJECT_STATUS_VALUES,
} from '@/lib/project/constants';

const orgId = z.uuid('组织 ID 无效');
const projectId = z.uuid('项目 ID 无效');
const memberId = z.uuid('成员 ID 无效');

// Trim + lowercase so storage, lookup and comparison all use one form.
// Zod applies string checks in chain order, so the transforms run first.
const normalizedEmail = z
  .string({
    error: (issue) =>
      issue.input === undefined ? '请输入邮箱' : '邮箱格式不正确',
  })
  .trim()
  .toLowerCase()
  .max(255, '邮箱不能超过 255 个字符')
  .pipe(z.email('邮箱格式不正确'));

const password = z
  .string({
    error: (issue) =>
      issue.input === undefined ? '请输入密码' : '密码格式不正确',
  })
  .min(8, '密码至少需要 8 个字符')
  .max(100, '密码不能超过 100 个字符');

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) => (value ? value : undefined));

// Updates distinguish "field omitted" (undefined) from "clear it" (null).
const clearableText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .optional()
    .transform((value) =>
      value === undefined ? undefined : value === '' ? null : value
    );

export const signInSchema = z.object({
  email: normalizedEmail,
  password,
});

export const signUpSchema = z.object({
  email: normalizedEmail,
  password,
  name: z
    .string()
    .trim()
    .max(100, '姓名不能超过 100 个字符')
    .optional()
    .transform((value) => (value ? value : undefined)),
  /**
   * 注册表单里透传的邀请凭据：链接 `/join?token=<43 字符>` 里的明文 token
   * （历史上叫 `?invite=`，名字留着是为了不打断已有邮件里的链接参数名）。
   * 上限 128 与 `acceptInviteSchema.token` 一致。
   */
  invite: z.string().trim().max(128).optional(),
});

export const acceptInviteSchema = z.object({
  /**
   * 邀请链接里的**明文 token**（`/join?token=<43 字符 base64url>`）。
   *
   * 不再是 uuid：自建 token 之后凭据是 32 字节随机值的 base64url，43 个字符。
   * 长度上限 128 足够宽松又不留出灌大字符串的口子；不校验字符集——token
   * 的合法性由 sha256 之后能不能在库里命中决定，在这里加白名单只会让
   * 「链接被邮件客户端改坏了」表现为一条与真实原因无关的表单错误。
   */
  token: z
    .string({ error: '邀请链接无效' })
    .trim()
    .min(16, '邀请链接无效')
    .max(128, '邀请链接无效'),
});

export const updatePasswordSchema = z.object({
  currentPassword: z
    .string({ error: '请输入当前密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
  newPassword: z
    .string({ error: '请输入新密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
  confirmPassword: z
    .string({ error: '请确认新密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
});

export const deleteAccountSchema = z.object({
  password: z
    .string({ error: '请输入密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
});

export const updateAccountSchema = z.object({
  name: z
    .string({ error: '请输入姓名' })
    .trim()
    .min(1, '请输入姓名')
    .max(100, '姓名不能超过 100 个字符'),
});

export const removeOrgMemberSchema = z.object({
  orgId,
  memberId,
});

export const updateOrgMemberRoleSchema = z.object({
  orgId,
  memberId,
  role: z.enum(['admin', 'editor', 'viewer'], {
    error: '请选择角色',
  }),
});

export const inviteOrgMemberSchema = z.object({
  orgId,
  email: normalizedEmail,
  role: z.enum(['admin', 'editor', 'viewer'], {
    error: '请选择角色',
  }),
});

export const createOrgSchema = z.object({
  name: z
    .string({ error: '请输入组织名称' })
    .trim()
    .min(1, '请输入组织名称')
    .max(100, '组织名称不能超过 100 个字符'),
});

export const renameOrgSchema = z.object({
  orgId,
  name: z
    .string({ error: '请输入组织名称' })
    .trim()
    .min(1, '请输入组织名称')
    .max(100, '组织名称不能超过 100 个字符'),
});

export const deleteOrgSchema = z.object({
  orgId,
});

const projectStatus = z.enum(PROJECT_STATUS_VALUES, {
  error: '请选择项目状态',
});

const projectImportance = z.coerce
  .number({
    error: '请选择重要等级',
  })
  .int('重要等级必须是整数')
  .min(1, '重要等级最低为 1 星')
  .max(PROJECT_IMPORTANCE_MAX, `重要等级最高为 ${PROJECT_IMPORTANCE_MAX} 星`);

export const createProjectSchema = z.object({
  orgId,
  name: z
    .string({ error: '请输入项目名' })
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    ),
  surname: z
    .string({ error: '请输入姓氏' })
    .trim()
    .min(1, '请输入姓氏')
    .max(
      MAX_PROJECT_SURNAME_LENGTH,
      `姓氏不能超过 ${MAX_PROJECT_SURNAME_LENGTH} 个字符`
    ),
  themeName: z
    .string({ error: '请输入主题名' })
    .trim()
    .min(1, '请输入主题名')
    .max(
      MAX_PROJECT_THEME_NAME_LENGTH,
      `主题名不能超过 ${MAX_PROJECT_THEME_NAME_LENGTH} 个字符`
    ),
  countriesRegions: z
    .string({ error: '请输入地区' })
    .trim()
    .min(1, '请输入地区')
    .max(
      MAX_PROJECT_REGIONS_LENGTH,
      `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
    ),
  status: projectStatus.default(DEFAULT_PROJECT_STATUS),
  importance: projectImportance.default(DEFAULT_PROJECT_IMPORTANCE),
  notes: optionalText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});

export const updateProjectSchema = z.object({
  orgId,
  projectId,
  name: z
    .string()
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    )
    .optional(),
  countriesRegions: clearableText(
    MAX_PROJECT_REGIONS_LENGTH,
    `地区不能超过 ${MAX_PROJECT_REGIONS_LENGTH} 个字符`
  ),
  hallCode: clearableText(60, '郡望/堂号不能超过 60 个字符'),
  status: projectStatus.optional(),
  importance: projectImportance.optional(),
  notes: clearableText(
    MAX_PROJECT_NOTES_LENGTH,
    `备注不能超过 ${MAX_PROJECT_NOTES_LENGTH} 个字符`
  ),
});

export const deleteProjectSchema = z.object({
  orgId,
  projectId,
});
