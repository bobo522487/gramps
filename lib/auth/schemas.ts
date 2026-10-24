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
  name: z
    .string()
    .trim()
    .max(100, '姓名不能超过 100 个字符')
    .optional()
    .transform((value) => (value ? value : undefined)),
  /** Better Auth invitation id from ?invite=<id>. */
  invite: z.string().trim().max(100).optional(),
});

export const acceptInviteSchema = z.object({
  invitationId: z
    .string({ required_error: '邀请链接无效' })
    .trim()
    .uuid('邀请链接无效'),
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

const projectStatus = z.enum(PROJECT_STATUS_VALUES, {
  required_error: '请选择项目状态',
  invalid_type_error: '请选择项目状态',
});

const projectImportance = z.coerce
  .number({
    required_error: '请选择重要等级',
    invalid_type_error: '请选择重要等级',
  })
  .int('重要等级必须是整数')
  .min(1, '重要等级最低为 1 星')
  .max(PROJECT_IMPORTANCE_MAX, `重要等级最高为 ${PROJECT_IMPORTANCE_MAX} 星`);

export const createProjectSchema = z.object({
  orgId,
  name: z
    .string({ required_error: '请输入项目名' })
    .trim()
    .min(1, '请输入项目名')
    .max(
      MAX_PROJECT_NAME_LENGTH,
      `项目名不能超过 ${MAX_PROJECT_NAME_LENGTH} 个字符`
    ),
  surname: z
    .string({ required_error: '请输入姓氏' })
    .trim()
    .min(1, '请输入姓氏')
    .max(
      MAX_PROJECT_SURNAME_LENGTH,
      `姓氏不能超过 ${MAX_PROJECT_SURNAME_LENGTH} 个字符`
    ),
  themeName: z
    .string({ required_error: '请输入主题名' })
    .trim()
    .min(1, '请输入主题名')
    .max(
      MAX_PROJECT_THEME_NAME_LENGTH,
      `主题名不能超过 ${MAX_PROJECT_THEME_NAME_LENGTH} 个字符`
    ),
  countriesRegions: z
    .string({ required_error: '请输入地区' })
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
