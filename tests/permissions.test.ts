import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  isOrgRole,
  ORG_PERMISSIONS,
  type OrgPermission,
  type OrgRole,
} from '@/lib/auth/permissions';

const expected: Record<OrgRole, OrgPermission[]> = {
  owner: [...ORG_PERMISSIONS],
  admin: [
    'content.read',
    'lineage.write',
    'article.write',
    'book.write',
    'project.write',
    'member.invite',
    'member.manage',
  ],
  editor: ['content.read', 'lineage.write', 'article.write', 'book.write'],
  viewer: ['content.read'],
};

describe('role permission matrix', () => {
  it('matches the documented matrix for all four roles', () => {
    for (const role of Object.keys(expected) as OrgRole[]) {
      for (const permission of ORG_PERMISSIONS) {
        expect(hasPermission(role, permission), `${role} / ${permission}`).toBe(
          expected[role].includes(permission)
        );
      }
    }
  });

  it('reserves organization settings and transfer for the owner', () => {
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      expect(hasPermission(role, 'org.settings')).toBe(false);
      expect(hasPermission(role, 'org.transfer')).toBe(false);
    }
    expect(hasPermission('owner', 'org.settings')).toBe(true);
    expect(hasPermission('owner', 'org.transfer')).toBe(true);
  });

  it('rejects role strings outside the four-role model', () => {
    expect(isOrgRole('owner')).toBe(true);
    expect(isOrgRole('admin')).toBe(true);
    expect(isOrgRole('editor')).toBe(true);
    expect(isOrgRole('viewer')).toBe(true);
    expect(isOrgRole('member')).toBe(false);
    expect(isOrgRole('')).toBe(false);
  });
});
