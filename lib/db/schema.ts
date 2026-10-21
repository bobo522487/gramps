import { relations, sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: varchar('role', { length: 20 }).notNull().default('member'),
  tokenVersion: integer('token_version').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  deletedAt: timestamp('deleted_at'),
});

export const organizations = pgTable(
  'organizations',
  {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    /** 20-char public id used in dashboard URLs. */
    slug: varchar('slug', { length: 20 }).notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('organizations_slug_idx').on(t.slug)]
);

export const orgMembers = pgTable(
  'org_members',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    orgId: integer('org_id')
      .notNull()
      .references(() => organizations.id),
    role: varchar('role', { length: 50 }).notNull(),
    joinedAt: timestamp('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('org_members_org_user_idx').on(t.orgId, t.userId),
    index('org_members_user_idx').on(t.userId),
    check('org_members_role_check', sql`${t.role} in ('owner', 'member')`),
  ]
);

export const projects = pgTable(
  'projects',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    /** 20-char public id used in dashboard URLs. */
    ref: varchar('ref', { length: 20 }).notNull(),
    region: varchar('region', { length: 60 }).notNull().default('us-east-1'),
    status: varchar('status', { length: 20 }).notNull().default('ACTIVE'),
    health: varchar('health', { length: 20 }).notNull().default('HEALTHY'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    lastDeployedAt: timestamp('last_deployed_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('projects_org_slug_idx').on(t.orgId, t.slug),
    uniqueIndex('projects_ref_idx').on(t.ref),
    check(
      'projects_status_check',
      sql`${t.status} in ('ACTIVE', 'PAUSED', 'ARCHIVED')`
    ),
    check('projects_health_check', sql`${t.health} in ('HEALTHY', 'DEGRADED')`),
  ]
);

export const activityLogs = pgTable(
  'activity_logs',
  {
    id: serial('id').primaryKey(),
    // Nullable so account-level events (sign-out, deletion) don't need a
    // misleading org attribution when the user belongs to several orgs.
    orgId: integer('org_id').references(() => organizations.id),
    userId: integer('user_id').references(() => users.id),
    action: text('action').notNull(),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
    ipAddress: varchar('ip_address', { length: 45 }),
  },
  (t) => [
    index('activity_logs_org_idx').on(t.orgId),
    index('activity_logs_user_idx').on(t.userId),
  ]
);

export const invitations = pgTable(
  'invitations',
  {
    id: serial('id').primaryKey(),
    orgId: integer('org_id')
      .notNull()
      .references(() => organizations.id),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 }).notNull(),
    invitedBy: integer('invited_by')
      .notNull()
      .references(() => users.id),
    invitedAt: timestamp('invited_at').notNull().defaultNow(),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
  },
  (t) => [
    index('invitations_org_idx').on(t.orgId),
    uniqueIndex('invitations_pending_org_email_idx')
      .on(t.orgId, sql`lower(${t.email})`)
      .where(sql`${t.status} = 'pending'`),
    check('invitations_role_check', sql`${t.role} in ('owner', 'member')`),
    check(
      'invitations_status_check',
      sql`${t.status} in ('pending', 'accepted')`
    ),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  orgMembers: many(orgMembers),
  activityLogs: many(activityLogs),
  invitations: many(invitations),
  projects: many(projects),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  organization: one(organizations, {
    fields: [projects.orgId],
    references: [organizations.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  orgMembers: many(orgMembers),
  invitationsSent: many(invitations),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.orgId],
    references: [organizations.id],
  }),
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
  }),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  user: one(users, {
    fields: [orgMembers.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [orgMembers.orgId],
    references: [organizations.id],
  }),
}));

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [activityLogs.orgId],
    references: [organizations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type OrgMember = typeof orgMembers.$inferSelect;
export type NewOrgMember = typeof orgMembers.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ActivityLog = typeof activityLogs.$inferSelect;
export type NewActivityLog = typeof activityLogs.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type NewInvitation = typeof invitations.$inferInsert;
export type OrgDataWithMembers = Organization & {
  orgMembers: (OrgMember & {
    user: Pick<User, 'id' | 'name' | 'email'>;
  })[];
};

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_ORG = 'CREATE_ORG',
  RENAME_ORG = 'RENAME_ORG',
  DELETE_ORG = 'DELETE_ORG',
  REMOVE_ORG_MEMBER = 'REMOVE_ORG_MEMBER',
  INVITE_ORG_MEMBER = 'INVITE_ORG_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  CREATE_PROJECT = 'CREATE_PROJECT',
  DELETE_PROJECT = 'DELETE_PROJECT',
}
