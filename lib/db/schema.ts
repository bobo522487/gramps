import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** PostgreSQL ltree (extension installed by the baseline migration). */
const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'ltree';
  },
});

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, mode: 'date' });

const uuidPk = () => uuid('id').primaryKey().default(sql`uuidv7()`);

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

export const projects = pgTable(
  'project',
  {
    id: uuidPk(),
    orgId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    /** 20-char public id used as the second URL segment. */
    ref: text('ref').notNull().default(sql`public.generate_public_id()`),
    name: text('name').notNull(),
    primaryName: text('primary_name').notNull(),
    primarySurname: text('primary_surname').notNull(),
    countriesRegions: text('countries_regions'),
    hallCode: text('hall_code'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    unique('uk_project_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_project_ref').on(t.ref).where(sql`${t.deletedAt} is null`),
    index('idx_project_organization')
      .on(t.orgId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const folders = pgTable(
  'folder',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    kind: smallint('kind').notNull(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_folder_project',
    }).onDelete('restrict'),
    index('idx_folder_project')
      .on(t.orgId, t.projectId, t.kind)
      .where(sql`${t.deletedAt} is null`),
    check('ck_folder_kind', sql`${t.kind} in (0, 1, 2)`),
  ]
);

export const lineages = pgTable(
  'lineage',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    surname: text('surname').notNull(),
    hallCode: text('hall_code'),
    generationWords: jsonb('generation_words').$type<string[]>(),
    hangRule: jsonb('hang_rule').$type<Record<string, unknown>>(),
    nodeCount: integer('node_count').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_lineage_project',
    }).onDelete('restrict'),
    unique('uk_lineage_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_lineage_name')
      .on(t.orgId, t.projectId, t.name)
      .where(sql`${t.deletedAt} is null`),
    index('idx_lineage_project')
      .on(t.orgId, t.projectId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const nodes = pgTable(
  'node',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    lineageId: uuid('lineage_id').notNull(),
    parentId: uuid('parent_id').references((): AnyPgColumn => nodes.id, {
      onDelete: 'restrict',
    }),
    motherId: uuid('mother_id').references((): AnyPgColumn => nodes.id, {
      onDelete: 'restrict',
    }),
    spouseOfId: uuid('spouse_of_id').references((): AnyPgColumn => nodes.id, {
      onDelete: 'restrict',
    }),
    role: text('role').notNull().default('blood'),
    path: ltree('path'),
    depth: integer('depth').notNull().default(0),
    generation: integer('generation').notNull(),
    sort: integer('sort').notNull().default(0),
    name: text('name').notNull(),
    surname: text('surname').notNull(),
    fullName: text('full_name').notNull(),
    sex: smallint('sex').notNull(),
    courtesy: text('courtesy'),
    namePrefix: text('name_prefix'),
    isAlive: boolean('is_alive').notNull().default(true),
    birthText: text('birth_text'),
    deathText: text('death_text'),
    birthYear: integer('birth_year'),
    deathYear: integer('death_year'),
    burialPlace: text('burial_place'),
    biography: text('biography'),
    attributes: jsonb('attributes')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.lineageId],
      foreignColumns: [lineages.orgId, lineages.id],
      name: 'fk_node_lineage',
    }).onDelete('restrict'),
    unique('uk_node_organization_id').on(t.orgId, t.id),
    check('ck_node_role', sql`${t.role} in ('blood', 'spouse')`),
    check('ck_node_sex', sql`${t.sex} in (0, 1)`),
    check(
      'ck_node_spouse_has_no_path',
      sql`(${t.role} = 'spouse' and ${t.path} is null and ${t.spouseOfId} is not null) or (${t.role} = 'blood' and ${t.path} is not null)`
    ),
    index('idx_node_lineage_depth').on(t.orgId, t.lineageId, t.depth),
    index('idx_node_parent').on(t.orgId, t.parentId),
    index('idx_node_alive')
      .on(t.orgId, t.lineageId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const articles = pgTable(
  'article',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    title: text('title').notNull(),
    kind: text('kind'),
    content: jsonb('content').$type<Record<string, unknown>>().notNull(),
    plainText: text('plain_text'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_article_project',
    }).onDelete('restrict'),
    unique('uk_article_organization_id').on(t.orgId, t.id),
    index('idx_article_project')
      .on(t.orgId, t.projectId)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const books = pgTable(
  'book',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    projectId: uuid('project_id').notNull(),
    folderId: uuid('folder_id'),
    name: text('name').notNull(),
    title: text('title').notNull(),
    surname: text('surname').notNull(),
    hallCode: text('hall_code'),
    volumeNo: text('volume_no'),
    author: text('author'),
    compiledAt: text('compiled_at'),
    coverSpec: jsonb('cover_spec')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    backCoverSpec: jsonb('back_cover_spec').$type<Record<string, unknown>>(),
    sort: integer('sort').notNull().default(0),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    updatedAt: timestamptz('updated_at'),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.projectId],
      foreignColumns: [projects.orgId, projects.id],
      name: 'fk_book_project',
    }).onDelete('restrict'),
    unique('uk_book_organization_id').on(t.orgId, t.id),
    uniqueIndex('uk_book_name')
      .on(t.orgId, t.projectId, t.name)
      .where(sql`${t.deletedAt} is null`),
  ]
);

export const bookCatalogs = pgTable(
  'book_catalog',
  {
    id: uuidPk(),
    orgId: uuid('organization_id').notNull(),
    bookId: uuid('book_id')
      .notNull()
      .references(() => books.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => bookCatalogs.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    section: smallint('section').notNull(),
    articleId: uuid('article_id'),
    lineageId: uuid('lineage_id'),
    sort: integer('sort').notNull().default(0),
    hide: boolean('hide').notNull().default(false),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').notNull(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [
    foreignKey({
      columns: [t.orgId, t.articleId],
      foreignColumns: [articles.orgId, articles.id],
      name: 'fk_catalog_article',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.lineageId],
      foreignColumns: [lineages.orgId, lineages.id],
      name: 'fk_catalog_lineage',
    }).onDelete('restrict'),
    check('ck_catalog_section', sql`${t.section} in (1, 2, 3)`),
    check(
      'ck_catalog_one_target',
      sql`num_nonnulls(${t.articleId}, ${t.lineageId}) <= 1`
    ),
    index('idx_catalog_book')
      .on(t.orgId, t.bookId, t.sort)
      .where(sql`${t.deletedAt} is null`),
    index('idx_catalog_article')
      .on(t.orgId, t.articleId)
      .where(sql`${t.articleId} is not null`),
    index('idx_catalog_lineage')
      .on(t.orgId, t.lineageId)
      .where(sql`${t.lineageId} is not null`),
  ]
);

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

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(orgMembers),
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

export const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [activityLogs.orgId],
    references: [organizations.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Verification = typeof verifications.$inferSelect;
export type NewVerification = typeof verifications.$inferInsert;
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
export type Folder = typeof folders.$inferSelect;
export type Lineage = typeof lineages.$inferSelect;
export type Node = typeof nodes.$inferSelect;
export type Article = typeof articles.$inferSelect;
export type Book = typeof books.$inferSelect;
export type BookCatalog = typeof bookCatalogs.$inferSelect;

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
