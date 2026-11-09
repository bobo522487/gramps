import { accounts, sessions, users, verifications } from './schema';

/**
 * Better Auth resolves `schema[modelName]`, so the keys are the singular
 * logical model names while the Drizzle property names match the fields the
 * adapter expects.
 *
 * T28 拆掉 organization 插件后，adapter 只管核心四模型；organization /
 * organization_member / invite 由本仓经业务连接（`lib/db/drizzle.ts` 的
 * withOrg / withAuth）直接读写，不再进 adapter 的 schema map。
 */
export const authSchemaMap = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
} as const;
