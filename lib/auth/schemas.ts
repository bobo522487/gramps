import { z } from 'zod';

const orgId = z.string().uuid('组织 ID 无效');
const projectId = z.string().uuid('项目 ID 无效');
const memberId = z.string().uuid('成员 ID 无效');

// Trim + lowercase so storage, lookup and comparison all use one form.
// Zod applies string checks in chain order, so the transforms run first.
const normalizedEmail = z
  .string({
    required_error: '请输入邮箱',
    invalid_type_error: '邮箱格式不正确',
  })
  .trim()
  .toLowerCase()
  .email('邮箱格式不正确')
  .max(255, '邮箱不能超过 255 个字符');

const password = z
  .string({
    required_error: '请输入密码',
    invalid_type_error: '密码格式不正确',
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
  /** Raw one-time invite token from ?invite=<token>. */
  invite: z.string().trim().max(200).optional(),
});

export const acceptInviteSchema = z.object({
  token: z
    .string({ required_error: '邀请链接无效' })
    .trim()
    .min(10, '邀请链接无效')
    .max(200, '邀请链接无效'),
});

export const updatePasswordSchema = z.object({
  currentPassword: z
    .string({ required_error: '请输入当前密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
  newPassword: z
    .string({ required_error: '请输入新密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
  confirmPassword: z
    .string({ required_error: '请确认新密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
});

export const deleteAccountSchema = z.object({
  password: z
    .string({ required_error: '请输入密码' })
    .min(8, '密码至少需要 8 个字符')
    .max(100, '密码不能超过 100 个字符'),
});

export const updateAccountSchema = z.object({
  name: z
    .string({ required_error: '请输入姓名' })
    .trim()
    .min(1, '请输入姓名')
    .max(100, '姓名不能超过 100 个字符'),
  email: normalizedEmail,
  // Required by the action only when the email address actually changes.
  currentPassword: z
    .string({ invalid_type_error: '密码格式不正确' })
    .max(100, '密码不能超过 100 个字符')
    .optional(),
});

export const removeOrgMemberSchema = z.object({
  orgId,
  memberId,
});

export const updateOrgMemberRoleSchema = z.object({
  orgId,
  memberId,
  role: z.enum(['admin', 'editor', 'viewer'], {
    required_error: '请选择角色',
    invalid_type_error: '请选择角色',
  }),
});

export const inviteOrgMemberSchema = z.object({
  orgId,
  email: normalizedEmail,
  role: z.enum(['admin', 'editor', 'viewer'], {
    required_error: '请选择角色',
    invalid_type_error: '请选择角色',
  }),
});

export const createOrgSchema = z.object({
  name: z
    .string({ required_error: '请输入组织名称' })
    .trim()
    .min(1, '请输入组织名称')
    .max(100, '组织名称不能超过 100 个字符'),
});

export const renameOrgSchema = z.object({
  orgId,
  name: z
    .string({ required_error: '请输入组织名称' })
    .trim()
    .min(1, '请输入组织名称')
    .max(100, '组织名称不能超过 100 个字符'),
});

export const deleteOrgSchema = z.object({
  orgId,
});

export const createProjectSchema = z.object({
  orgId,
  name: z
    .string({ required_error: '请输入云谱空间名称' })
    .trim()
    .min(1, '请输入云谱空间名称')
    .max(100, '云谱空间名称不能超过 100 个字符'),
  primaryName: z
    .string({ required_error: '请输入主姓名' })
    .trim()
    .min(1, '请输入主姓名')
    .max(60, '主姓名不能超过 60 个字符'),
  primarySurname: z
    .string({ required_error: '请输入主姓氏' })
    .trim()
    .min(1, '请输入主姓氏')
    .max(30, '主姓氏不能超过 30 个字符'),
  hallCode: optionalText(60, '郡望/堂号不能超过 60 个字符'),
  countriesRegions: optionalText(100, '国家/地区不能超过 100 个字符'),
});

export const updateProjectSchema = z.object({
  orgId,
  projectId,
  name: z
    .string()
    .trim()
    .min(1, '请输入云谱空间名称')
    .max(100, '云谱空间名称不能超过 100 个字符')
    .optional(),
  primaryName: z
    .string()
    .trim()
    .min(1, '请输入主姓名')
    .max(60, '主姓名不能超过 60 个字符')
    .optional(),
  primarySurname: z
    .string()
    .trim()
    .min(1, '请输入主姓氏')
    .max(30, '主姓氏不能超过 30 个字符')
    .optional(),
  hallCode: clearableText(60, '郡望/堂号不能超过 60 个字符'),
  countriesRegions: clearableText(100, '国家/地区不能超过 100 个字符'),
});

export const deleteProjectSchema = z.object({
  orgId,
  projectId,
});
