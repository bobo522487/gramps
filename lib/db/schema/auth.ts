import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgSchema,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organizations } from './org';
import { timestamptz, uuidPk } from './shared';

export const authSchema = pgSchema('auth');

/**
 * Better Auth 用户表。目标态（附录 A.0）的表名是**单数** `auth.user`、
 * 主键是 **`text`**——所有引用它的列（`organization.created_by`、
 * `project.created_by`、`team_member.user_id` 等）都是 `text`，基线 DDL 依此建表。
 *
 * 这张表曾经叫 `users` 且主键是 `uuid`，是 B0 重建基线前的形状；两边不一致时
 * 症状是运行期 `relation "auth.users" does not exist`（adapter 从 Drizzle 表对象
 * 取表名，不会去读基线），所以这里必须跟基线逐字对齐，不能各写各的。
 *
 * `app_rw` 读不到它；认证连接经 `auth_service`，业务侧读邮箱走 SECURITY DEFINER
 * 函数（附录 A.6）。
 */
export const users = authSchema.table(
  'user',
  {
    // 附录 A.0 里这是无默认值的 `text PRIMARY KEY`，但应用侧
    // `advanced.database.generateId = false`，ID 一律由数据库生成，所以要有
    // 默认值——缺了它就是建号时 `null value in column "id"`。
    id: text('id').primaryKey().default(sql`gen_random_uuid()::text`),
    email: text('email').notNull(),
    name: text('name'),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_auth_user_email').on(sql`lower(${t.email})`),
    index('idx_auth_user_email').on(t.email),
  ]
);

export const sessions = authSchema.table(
  'session',
  {
    id: uuidPk(),
    expiresAt: timestamptz('expires_at').notNull(),
    token: text('token').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    activeOrganizationId: uuid('active_organization_id').references(
      () => organizations.id,
      { onDelete: 'set null' }
    ),
  },
  (t) => [
    uniqueIndex('uk_auth_session_token').on(t.token),
    index('idx_auth_session_user').on(t.userId),
  ]
);

export const accounts = authSchema.table(
  'account',
  {
    id: uuidPk(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamptz('access_token_expires_at'),
    refreshTokenExpiresAt: timestamptz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_auth_account_provider_account').on(
      t.providerId,
      t.accountId
    ),
    index('idx_auth_account_user').on(t.userId),
  ]
);

export const verifications = authSchema.table(
  'verification',
  {
    id: uuidPk(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('idx_auth_verification_identifier').on(t.identifier),
    index('idx_auth_verification_expires').on(t.expiresAt),
  ]
);
