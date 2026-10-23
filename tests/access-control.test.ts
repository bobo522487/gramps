import { describe, expect, it, vi } from 'vitest';
import {
  PERMISSION_REQUESTS,
  roles,
  statement,
} from '@/lib/auth/access-control';
import {
  hasPermission,
  isOrgRole,
  ORG_PERMISSIONS,
  type OrgPermission,
  type OrgRole,
  PERMISSION_DENIED_MESSAGES,
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

describe('Better Auth access control statements', () => {
  it('keeps the organization defaults and adds transfer plus genealogy resources', () => {
    expect(statement.organization).toEqual(
      expect.arrayContaining(['update', 'delete', 'transfer'])
    );
    expect(statement.member).toEqual(['create', 'update', 'delete']);
    expect(statement.invitation).toEqual(['create', 'cancel']);
    expect(statement.content).toEqual(['read']);
    expect(statement.lineage).toEqual(['write']);
    expect(statement.article).toEqual(['write']);
    expect(statement.book).toEqual(['write']);
    expect(statement.project).toEqual(['write']);
  });

  it('grants organization transfer to the owner only', () => {
    expect(roles.owner.authorize({ organization: ['transfer'] }).success).toBe(
      true
    );
    for (const role of ['admin', 'editor', 'viewer'] as const) {
      expect(
        roles[role].authorize({ organization: ['transfer'] }).success
      ).toBe(false);
    }
  });
});

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

  it('delegates every check to Better Auth access control', () => {
    const spy = vi.spyOn(roles.admin, 'authorize');
    expect(hasPermission('admin', 'member.invite')).toBe(true);
    expect(spy).toHaveBeenCalledWith(PERMISSION_REQUESTS['member.invite']);
    spy.mockRestore();
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

describe('permission denied messages', () => {
  it('keeps a Chinese refusal message for every permission', () => {
    for (const permission of ORG_PERMISSIONS) {
      const message = PERMISSION_DENIED_MESSAGES[permission];
      expect(message, permission).toMatch(/[\u4e00-\u9fff]/);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
