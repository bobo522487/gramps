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
    // 附录 A.1 的目标态**没有**这个代理主键，自然键是成员对。
    //
    // 但它现在必须留着：Better Auth 的 organization 插件直接读 `member.id`，
    // 缺这列时 `createAuth()` 一初始化就报 `Drizzle schema mismatch —
    // Missing columns: member.id`，整条认证链路（登录 / 会话 / 成员管理）
    // 全部不可用。实测 232 条集成测试会全红。
    //
    // 去插件（T28）与去主键是同一个约束的两面，不可能只成立一边，所以这一处
    // 回退并入 B4，与 T28 同批做。`uk_org_member_organization_user` 同样留到那批
    // 一并删——主键还在时它是重复约束，但提前删会让本批无法验证插件行为。
    id: uuidPk(),
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
    unique('uk_org_member_organization_user').on(t.organizationId, t.userId),
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
    status: text('status').notNull().default('pending'),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    // Target state (appendix A.1): `(organization_id, id)` key. Column-level
    // rework (`token_hash` / `accepted_at` / `invited_by text`) is B2b.
    primaryKey({ columns: [t.organizationId, t.id] }),
    uniqueIndex('uk_invite_pending_email')
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    index('idx_invite_expiry')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'pending'`),
    check('ck_invite_role', sql`${t.role} in ('admin', 'editor', 'viewer')`),
    check(
      'ck_invite_status',
      sql`${t.status} in ('pending', 'accepted', 'rejected', 'canceled')`
    ),
  ]
);
