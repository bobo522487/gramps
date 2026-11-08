import { relations } from 'drizzle-orm';
import { accounts, sessions, users } from './auth';
import { invitations, organizations, orgMembers } from './org';
import { projects } from './project';

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
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
  memberships: many(orgMembers),
  sessions: many(sessions),
  accounts: many(accounts),
  invitationsSent: many(invitations, { relationName: 'invitedBy' }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  activeOrganization: one(organizations, {
    fields: [sessions.activeOrganizationId],
    references: [organizations.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  organization: one(organizations, {
    fields: [invitations.organizationId],
    references: [organizations.id],
  }),
  // `invitedBy` 可空：邀请人注销后邀请行要留着（ON DELETE SET NULL）。
  // 关系名跟着列名走，`inviter` 会让人以为这条关系永远有值。
  invitedBy: one(users, {
    fields: [invitations.invitedBy],
    references: [users.id],
    relationName: 'invitedBy',
  }),
}));

export const orgMembersRelations = relations(orgMembers, ({ one }) => ({
  user: one(users, {
    fields: [orgMembers.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [orgMembers.organizationId],
    references: [organizations.id],
  }),
}));
