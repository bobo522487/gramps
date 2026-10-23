import {
  accounts,
  invitations,
  organizations,
  orgMembers,
  sessions,
  users,
  verifications,
} from './schema';

/**
 * Better Auth resolves `schema[modelName]`, so the keys are the singular
 * logical model names while the Drizzle property names match the fields the
 * adapter expects.
 */
export const authSchemaMap = {
  user: users,
  session: sessions,
  account: accounts,
  verification: verifications,
  organization: organizations,
  member: orgMembers,
  invitation: invitations,
} as const;
