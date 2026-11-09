import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { getServerConfig } from '@/lib/config';
import { getAuthDb } from '@/lib/db/auth-db';
import { authSchemaMap } from '@/lib/db/auth-schema';

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

function createAuth() {
  const config = getServerConfig();

  return betterAuth({
    appName: '云谱',
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.BETTER_AUTH_URL],
    database: drizzleAdapter(getAuthDb(), {
      provider: 'pg',
      schema: authSchemaMap,
      transaction: true,
    }),
    advanced: {
      database: {
        // UUIDv7 defaults live in PostgreSQL; only session tokens are generated here.
        generateId: false,
        /**
         * 关掉 Better Auth 1.7.12 的 Drizzle schema 自检。
         *
         * 自检命中 mismatch 时**抛异常**：`@better-auth/core` 的
         * `runWithTransaction` 在开事务前 `await pendingSchemaCheck`。T28 拆掉
         * organization 插件后 adapter 只管核心四模型，`auth.session` 仍保留
         * 目标态的 `active_organization_id`（附录 A.0）——这一列不在核心模型
         * 字段表里，自检把它当 mismatch 就会让每个写请求失败。列形状以基线
         * DDL 为真相源，自检没有发言权，保持关闭。
         */
        validateSchema: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 100,
    },
    session: {
      expiresIn: SEVEN_DAYS_IN_SECONDS,
      updateAge: ONE_DAY_IN_SECONDS,
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: true },
    },
    plugins: [
      // Must stay last: it writes the session cookie through next/headers.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!instance) {
    instance = createAuth();
  }
  return instance;
}
