import { getTableColumns } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { authSchemaMap } from '@/lib/db/auth-schema';
import {
  accounts,
  invitations,
  organizations,
  orgMembers,
  sessions,
  users,
  verifications,
} from '@/lib/db/schema';

function columnKeys(table: Parameters<typeof getTableColumns>[0]) {
  return Object.keys(getTableColumns(table));
}

describe('Better Auth schema', () => {
  it('keeps the four auth tables in the auth schema', () => {
    for (const table of [users, sessions, accounts, verifications]) {
      expect(getTableConfig(table).schema).toBe('auth');
    }
  });

  it('shapes auth.users for Better Auth', () => {
    const keys = columnKeys(users);

    expect(keys).toEqual(
      expect.arrayContaining([
        'id',
        'email',
        'name',
        'emailVerified',
        'image',
        'createdAt',
        'updatedAt',
      ])
    );
    expect(keys).not.toEqual(
      expect.arrayContaining(['passwordHash', 'tokenVersion', 'deletedAt'])
    );
  });

  it('shapes auth.session for the organization plugin', () => {
    expect(columnKeys(sessions)).toEqual(
      expect.arrayContaining([
        'id',
        'expiresAt',
        'token',
        'createdAt',
        'updatedAt',
        'ipAddress',
        'userAgent',
        'userId',
        'activeOrganizationId',
      ])
    );
  });

  it('shapes auth.account for password sign-in', () => {
    expect(columnKeys(accounts)).toEqual(
      expect.arrayContaining([
        'id',
        'accountId',
        'providerId',
        'userId',
        'password',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('shapes auth.verification', () => {
    expect(columnKeys(verifications)).toEqual(
      expect.arrayContaining([
        'id',
        'identifier',
        'value',
        'expiresAt',
        'createdAt',
        'updatedAt',
      ])
    );
  });

  it('adds Better Auth organization fields', () => {
    expect(columnKeys(organizations)).toEqual(
      expect.arrayContaining(['logo', 'metadata', 'updatedAt'])
    );
  });

  it('renames member fields and drops soft delete', () => {
    const keys = columnKeys(orgMembers);

    expect(keys).toEqual(
      expect.arrayContaining(['organizationId', 'userId', 'role', 'createdAt'])
    );
    expect(keys).not.toEqual(
      expect.arrayContaining(['orgId', 'createdBy', 'deletedAt'])
    );
  });

  it('shapes invite as a Better Auth invitation', () => {
    const keys = columnKeys(invitations);

    expect(keys).toEqual(
      expect.arrayContaining([
        'organizationId',
        'email',
        'role',
        'status',
        'expiresAt',
        'inviterId',
        'createdAt',
      ])
    );
    expect(keys).not.toEqual(
      expect.arrayContaining([
        'orgId',
        'createdBy',
        'tokenHash',
        'acceptedAt',
        'acceptedBy',
        'deletedAt',
      ])
    );
  });

  it('maps singular Better Auth model names to tables', () => {
    expect(authSchemaMap).toEqual({
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      organization: organizations,
      member: orgMembers,
      invitation: invitations,
    });
  });
});
