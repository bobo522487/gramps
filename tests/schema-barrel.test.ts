import { describe, expect, it } from 'vitest';
import * as schema from '@/lib/db/schema';

const TABLE_EXPORTS = [
  'users',
  'sessions',
  'accounts',
  'verifications',
  'organizations',
  'orgMembers',
  'invitations',
  'projects',
  'folders',
  'lineages',
  'nodes',
  'articles',
  'books',
  'bookCatalogs',
  'activityLogs',
] as const;

describe('schema barrel', () => {
  it('re-exports every table object', () => {
    for (const name of TABLE_EXPORTS) {
      // toHaveProperty keeps the check static enough for noDynamicNamespaceImportAccess
      expect(schema, name).toHaveProperty(name);
    }
  });

  it('re-exports authSchema and the ActivityType enum', () => {
    expect(schema.authSchema.schemaName).toBe('auth');
    expect(schema.ActivityType.CREATE_NODE).toBe('CREATE_NODE');
  });
});
