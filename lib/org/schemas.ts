import { z } from 'zod';
import { memberId, normalizedEmail, orgId } from '@/lib/forms/primitives';

/**
 * Org-domain form schemas.
 *
 * These used to live in `lib/auth/schemas.ts`. They belong here: the org module
 * owns organization and membership forms, and pulling them out lets auth stop
 * being the catch-all import target for every domain's validation.
 */

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
