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
 * Self-hosted Better Auth user table. Not reachable by app_rw directly; the
 * auth runtime reads it through auth_service and the SECURITY DEFINER
 * functions in the `auth` schema.
 */
export const users = authSchema.table(
  'users',
  {
    id: uuidPk(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uk_auth_users_email').on(sql`lower(${t.email})`),
    index('idx_auth_users_email').on(t.email),
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
    userId: uuid('user_id')
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
    userId: uuid('user_id')
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
