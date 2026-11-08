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

  it('shapes auth.user for Better Auth', () => {
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
    // 已核对 better-auth 的 organization 模型字段表（organization.mjs 的
    // `schema.organization.fields`）：只有 name / slug / logo / createdAt /
    // metadata，**没有 updatedAt**，所以目标态删掉它是安全的。
    expect(columnKeys(organizations)).toEqual(
      expect.arrayContaining(['logo', 'metadata', 'createdAt'])
    );
    expect(columnKeys(organizations)).not.toContain('updatedAt');
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

  it('shapes invite to the target model, not to the plugin', () => {
    // B2b 之前这条断言的是「像一封 Better Auth 邀请」：`inviterId` 必填、
    // 不许有 `tokenHash` / `acceptedAt`。自建 token 之后方向反了——插件
    // 不再写这张表，列形状以附录 A.1 为准。
    const keys = columnKeys(invitations);

    expect(keys).toEqual(
      expect.arrayContaining([
        'organizationId',
        'email',
        'role',
        'status',
        'expiresAt',
        'tokenHash',
        'acceptedAt',
        'invitedBy',
        'createdAt',
      ])
    );
    expect(keys).not.toEqual(
      expect.arrayContaining([
        'orgId',
        'createdBy',
        // 插件的列名：`inviterId` 是 NOT NULL + RESTRICT 的形状，B2b 换成了
        // 可空 + SET NULL 的 `invited_by`。
        'inviterId',
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
