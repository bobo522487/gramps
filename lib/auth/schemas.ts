import { z } from 'zod';

const orgId = z.coerce
  .number({ invalid_type_error: '组织 ID 无效' })
  .int('组织 ID 无效')
  .positive('组织 ID 无效');
const projectId = z.coerce
  .number({ invalid_type_error: '项目 ID 无效' })
  .int('项目 ID 无效')
  .positive('项目 ID 无效');

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

export const signInSchema = z.object({
  email: normalizedEmail,
  password,
});

export const signUpSchema = z.object({
  email: normalizedEmail,
  password,
  inviteId: z.string().optional(),
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
    .min(1, '请输入姓名')
    .max(100, '姓名不能超过 100 个字符'),
  email: z
    .string({ required_error: '请输入邮箱' })
    .email('邮箱格式不正确')
    .max(255, '邮箱不能超过 255 个字符'),
});

export const removeOrgMemberSchema = z.object({
  orgId,
  memberId: z.coerce
    .number({ invalid_type_error: '成员 ID 无效' })
    .int('成员 ID 无效')
    .positive('成员 ID 无效'),
});

export const inviteOrgMemberSchema = z.object({
  orgId,
  email: z
    .string({ required_error: '请输入邮箱' })
    .email('邮箱格式不正确')
    .max(255, '邮箱不能超过 255 个字符'),
  role: z.enum(['member', 'owner'], {
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
    .string({ required_error: '请输入项目名称' })
    .trim()
    .min(1, '请输入项目名称')
    .max(100, '项目名称不能超过 100 个字符'),
  region: z
    .string({ required_error: '请选择区域' })
    .trim()
    .min(1, '请选择区域')
    .max(60, '区域无效')
    .default('us-east-1'),
});

export const updateProjectSchema = z.object({
  orgId,
  projectId,
  name: z
    .string({ required_error: '请输入项目名称' })
    .trim()
    .min(1, '请输入项目名称')
    .max(100, '项目名称不能超过 100 个字符')
    .optional(),
  status: z
    .enum(['ACTIVE', 'PAUSED', 'ARCHIVED'], {
      invalid_type_error: '请选择项目状态',
    })
    .optional(),
});

export const deleteProjectSchema = z.object({
  orgId,
  projectId,
});
