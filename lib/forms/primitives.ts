import { z } from 'zod';

/**
 * Cross-domain Zod form primitives.
 *
 * These are the validation building blocks shared by the auth, org and project
 * action schemas. They used to live in `lib/auth/schemas.ts`, which made auth —
 * a foundational module — import from `lib/project/constants` and forced every
 * domain to reach across into auth for its own forms. Putting the shared bits
 * here keeps auth a pure domain module and lets each domain own its schemas.
 */

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

export {
  clearableText,
  memberId,
  normalizedEmail,
  optionalText,
  orgId,
  password,
  projectId,
};
