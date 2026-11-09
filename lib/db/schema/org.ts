import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { scopedUuid, timestamptz, uuidPk } from './shared';

export const organizations = pgTable(
  'organization',
  {
    id: uuidPk(),
    /** 20-char public id used as the first URL segment. Never user-supplied. */
    slug: text('slug').notNull().default(sql`public.generate_public_id()`),
    name: text('name').notNull(),
    logo: text('logo'),
    /**
     * Better Auth's organization adapter JSON.stringify()s this value before
     * writing and parses it back only when it is a string, so the column stays
     * text rather than jsonb.
     */
    metadata: text('metadata'),
    status: text('status').notNull().default('active'),
    // 附录 A.1：可空 + SET NULL——建号触发器与 app.create_organization 会写它，
    // 但历史数据 / 触发器之外的路径允许为空；加号人注销后组织行要留痕。
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Target state (appendix A.1) has no soft delete / updated_at. `slug` is a
    // documented target-state extension column (see docs/data-model.md §4) so
    // the public URL segment survives; with soft delete gone the uniqueness is
    // total rather than partial.
    uniqueIndex('uk_organization_slug').on(t.slug),
    check(
      'ck_organization_status',
      sql`${t.status} in ('active', 'suspended', 'closed')`
    ),
  ]
);

export const orgMembers = pgTable(
  'organization_member',
  {
    // 附录 A.1 目标态：主键是成员对 (organization_id, user_id)，无代理主键。
    // 旧代理键 `id` 是 Better Auth organization 插件的读法（插件按 member.id
    // 定位），T28 拆插件后随之退役——成员寻址一律按 user_id。
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    // `auth.user` 删账号时必须连带删成员行（附录 A.1：ON DELETE CASCADE）。
    // 这里若写 restrict，销号会直接报 23503 而卡死。
    // 列类型必须与 `auth.user(id)` 的 `text` 一致，否则建表报 42804。
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    uniqueIndex('uk_org_member_single_owner')
      .on(t.organizationId)
      .where(sql`${t.role} = 'owner'`),
    index('idx_org_member_user').on(t.userId),
    check(
      'ck_org_member_role',
      sql`${t.role} in ('owner', 'admin', 'editor', 'viewer')`
    ),
  ]
);

export const invitations = pgTable(
  'invite',
  {
    id: scopedUuid(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    /**
     * 存的是**随机 token 的 sha256**，不是令牌本体（附录 A.1）。
     *
     * 明文只在创建邀请的那一刻出现在返回给管理员的链接里，此后库里再也
     * 找不到它：数据库被读走的人拿不到可用的邀请链接。这也意味着
     * `invite.id` 不能再当 bearer 凭据——uuid 是随机但会出现在
     * `listInvitations` 的响应、日志与 URL 里，一旦当凭据就等于凭据可被
     * 抄走。寻址一律走 `token_hash`。
     */
    tokenHash: text('token_hash')
      .notNull()
      // 带默认值不是为了让「忘了传 token」蒙混过关——业务代码每一处插入都显式
      // 写它（`lib/org/invitations.ts` 是唯一写入路径）。这里挂默认值是为了
      // 让 Better Auth 的 schema 自检放过这一列：插件的 `invitation` 模型不写
      // `tokenHash`，自检遇到「非空 + 无默认值的列」会判定每次插入都会失败并
      // 在**每个**用到 auth 的请求上打一条 ERROR（1.7.12 的
      // `diffSchema` / `unexpected-required-column`）。
      //
      // 默认值取 64 位十六进制随机串：即使真有人漏传，落库的也是一条永远
      // 匹配不上任何明文 token 的行，而不是空串或可预测值。
      //
      // 用 `gen_random_uuid()` 而不是 `gen_random_bytes()`：后者属于 pgcrypto，
      // 基线没装这个扩展，加了默认值就要求全库多一个扩展——为一个占位默认值
      // 扩大攻击面不划算。`gen_random_uuid()` 自 PG13 起是内置函数。
      .default(
        sql`replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')`
      )
      .unique(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamptz('expires_at').notNull(),
    /**
     * 与 `status` 是两条单向蕴含（附录 A.1）：
     * `accepted` 必须有时刻；有时刻的只可能是 `accepted` / `revoked`。
     */
    acceptedAt: timestamptz('accepted_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    /**
     * 可空 + `SET NULL`：加号人注销后邀请仍然要留痕。旧实现是
     * `NOT NULL` + `RESTRICT`，等于「谁邀请的谁不能注销」——把邀请记录
     * 变成账号的附属物，方向反了。
     */
    invitedBy: text('invited_by').references(() => users.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.id] }),
    // 基线是 `CONSTRAINT invite_email_unique UNIQUE (organization_id, email)`。
    // 无软删后不需要「同组织同邮箱只能有一条 pending」的部分索引：重发走
    // 附录 A.7 的 `ON CONFLICT … DO UPDATE` 原地更新同一行。
    unique('uk_invite_org_email').on(t.organizationId, t.email),
    index('idx_invite_org_status').on(t.organizationId, t.status),
    index('idx_invite_expiry')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    check('ck_invite_role', sql`${t.role} in ('admin', 'editor', 'viewer')`),
    // 取值跟基线，不跟 Better Auth 插件。插件自己会写 'rejected' /
    // 'canceled'，在基线上是 23514——两套值域并存的唯一结果是其中一套
    // 永远撞约束。自建 token 后插件不再写这张表，所以这里只需覆盖基线。
    check(
      'ck_invite_status',
      sql`${t.status} in ('pending', 'accepted', 'revoked')`
    ),
  ]
);
