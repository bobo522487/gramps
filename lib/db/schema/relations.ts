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
  invitationsSent: many(invitations),
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
  inviter: one(users, {
    fields: [invitations.inviterId],
    references: [users.id],
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
