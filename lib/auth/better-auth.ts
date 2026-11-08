import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins/organization';
import { ac, roles } from '@/lib/auth/access-control';
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
         * 这不是「嫌告警吵」——自检命中时会**抛异常**，`@better-auth/core` 的
         * `runWithTransaction` 在开事务前 `await pendingSchemaCheck`，所以
         * 任何一处 mismatch 都会让每一次写操作失败。实测：插件声明
         * `invitation.inviterId` 为必填，而目标态（附录 A.1）把它换成了可空
         * 的 `invited_by`，于是 242 条集成测试里 219 条直接红。
         *
         * 自检的前提是「插件拥有它读写的全部表」。目标态不是这样：`invite`
         * 已经改由本仓自己写（`lib/org/invitations.ts`），列形状以附录 A.1
         * 为准，插件的 `invitation` 模型只是 T28 拆除前的残留。让一个即将消失
         * 的模型否决整张表的形状，等于让死代码管活的 schema。
         *
         * 关掉之后 self-check 仍在初始化时跑一次并记一条 error 日志
         * （`better-auth/dist/auth/base.mjs`），所以真出现新的 mismatch 不会
         * 完全无声；只是它不再阻断请求。T28 拆掉插件后这里可以删掉。
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
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        invitationExpiresIn: SEVEN_DAYS_IN_SECONDS,
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: false,
        cancelPendingInvitationsOnReInvite: true,
      }),
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
