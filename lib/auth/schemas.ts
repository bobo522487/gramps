import { z } from 'zod';
import { normalizedEmail, password } from '@/lib/forms/primitives';

/**
 * Auth-domain form schemas only.
 *
 * Org and project forms moved to `lib/org/schemas.ts` and
 * `lib/project/schemas.ts` respectively, so this module no longer reaches into
 * other domains (it previously imported `lib/project/constants`). Shared
 * validation primitives come from `lib/forms/primitives.ts`.
 */

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
