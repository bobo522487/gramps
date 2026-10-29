import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { timestamptz, uuidPk } from './shared';

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
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    uniqueIndex('uk_organization_slug')
      .on(t.slug)
      .where(sql`${t.deletedAt} is null`),
    check(
      'ck_organization_status',
      sql`${t.status} in ('active', 'suspended', 'closed')`
    ),
  ]
);

export const orgMembers = pgTable(
  'organization_member',
  {
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_org_member_organization_user').on(
      t.organizationId,
      t.userId
    ),
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
    id: uuidPk(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [
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
