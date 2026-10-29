import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { organizations } from './org';
import { timestamptz, uuidPk } from './shared';

/**
 * Product activity feed, not an audit log. Account-level events have a null
 * organization_id. Kept outside the ten business tables.
 */
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    timestamp: timestamptz('timestamp').notNull().defaultNow(),
    ipAddress: text('ip_address'),
  },
  (t) => [
    index('idx_activity_logs_org').on(t.orgId),
    index('idx_activity_logs_user').on(t.userId),
  ]
);

export enum ActivityType {
  SIGN_UP = 'SIGN_UP',
  SIGN_IN = 'SIGN_IN',
  SIGN_OUT = 'SIGN_OUT',
  UPDATE_PASSWORD = 'UPDATE_PASSWORD',
  DELETE_ACCOUNT = 'DELETE_ACCOUNT',
  UPDATE_ACCOUNT = 'UPDATE_ACCOUNT',
  CREATE_ORG = 'CREATE_ORG',
  RENAME_ORG = 'RENAME_ORG',
  ARCHIVE_ORG = 'ARCHIVE_ORG',
  REMOVE_ORG_MEMBER = 'REMOVE_ORG_MEMBER',
  UPDATE_MEMBER_ROLE = 'UPDATE_MEMBER_ROLE',
  INVITE_ORG_MEMBER = 'INVITE_ORG_MEMBER',
  ACCEPT_INVITATION = 'ACCEPT_INVITATION',
  CREATE_PROJECT = 'CREATE_PROJECT',
  UPDATE_PROJECT = 'UPDATE_PROJECT',
  DELETE_PROJECT = 'DELETE_PROJECT',
  CREATE_FOLDER = 'CREATE_FOLDER',
  RENAME_FOLDER = 'RENAME_FOLDER',
  DELETE_FOLDER = 'DELETE_FOLDER',
  CREATE_LINEAGE = 'CREATE_LINEAGE',
  UPDATE_LINEAGE = 'UPDATE_LINEAGE',
  DELETE_LINEAGE = 'DELETE_LINEAGE',
  CREATE_NODE = 'CREATE_NODE',
  UPDATE_NODE = 'UPDATE_NODE',
  DELETE_NODE = 'DELETE_NODE',
  MOVE_NODE = 'MOVE_NODE',
  CREATE_ARTICLE = 'CREATE_ARTICLE',
  UPDATE_ARTICLE = 'UPDATE_ARTICLE',
  DELETE_ARTICLE = 'DELETE_ARTICLE',
  CREATE_BOOK = 'CREATE_BOOK',
  UPDATE_BOOK = 'UPDATE_BOOK',
  DELETE_BOOK = 'DELETE_BOOK',
}
