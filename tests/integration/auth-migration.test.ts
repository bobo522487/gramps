import { beforeAll, describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';

type Sql = ReturnType<typeof getTestSql>;

let sql: Sql;

beforeAll(() => {
  sql = getTestSql();
});

async function createUser(email: string, name: string) {
  const rows = await sql<{ id: string }[]>`
    insert into auth.users (email, name)
    values (${email}, ${name})
    returning id
  `;
  return rows[0];
}

async function personalOrg(userId: string) {
  const rows = await sql<
    { id: string; name: string; role: string; slug: string }[]
  >`
    select o.id, o.name, o.slug, m.role
    from organization_member m
    join organization o on o.id = m.organization_id
    where m.user_id = ${userId}
    limit 1
  `;
  return rows[0];
}

describe('0003_better_auth migration', () => {
  it('creates the auth tables with forced RLS', async () => {
    const rows = await sql<
      {
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }[]
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'auth'
        and c.relname in ('users', 'session', 'account', 'verification')
      order by c.relname
    `;

    expect(rows.map((row) => row.relname)).toEqual([
      'account',
      'session',
      'users',
      'verification',
    ]);
    for (const row of rows) {
      expect(row.relrowsecurity).toBe(true);
      expect(row.relforcerowsecurity).toBe(true);
    }
  });

  it('keeps app_rw read-only on tenant tables and locked out of auth', async () => {
    const [row] = await sql<
      {
        auth_users_select: boolean;
        auth_users_insert: boolean;
        org_insert: boolean;
        org_delete: boolean;
        member_insert: boolean;
        member_update: boolean;
        invite_select: boolean;
      }[]
    >`
      select
        has_table_privilege('app_rw', 'auth.users', 'SELECT') as auth_users_select,
        has_table_privilege('app_rw', 'auth.users', 'INSERT') as auth_users_insert,
        has_table_privilege('app_rw', 'organization', 'INSERT') as org_insert,
        has_table_privilege('app_rw', 'organization', 'DELETE') as org_delete,
        has_table_privilege('app_rw', 'organization_member', 'INSERT') as member_insert,
        has_table_privilege('app_rw', 'organization_member', 'UPDATE') as member_update,
        has_table_privilege('app_rw', 'invite', 'SELECT') as invite_select
    `;

    expect(row).toEqual({
      auth_users_select: false,
      auth_users_insert: false,
      org_insert: false,
      org_delete: false,
      member_insert: false,
      member_update: false,
      invite_select: false,
    });
  });

  it('gives auth_service tenant and auth access without bypassing RLS', async () => {
    const [role] = await sql<
      { rolsuper: boolean; rolcanlogin: boolean; rolbypassrls: boolean }[]
    >`
      select rolsuper, rolcanlogin, rolbypassrls
      from pg_roles
      where rolname = 'auth_service'
    `;

    expect(role).toEqual({
      rolsuper: false,
      rolcanlogin: false,
      rolbypassrls: false,
    });

    const [row] = await sql<
      {
        auth_select: boolean;
        auth_delete: boolean;
        org_update: boolean;
        org_delete: boolean;
        member_delete: boolean;
        invite_update: boolean;
        project_select: boolean;
      }[]
    >`
      select
        has_table_privilege('auth_service', 'auth.users', 'SELECT') as auth_select,
        has_table_privilege('auth_service', 'auth.users', 'DELETE') as auth_delete,
        has_table_privilege('auth_service', 'organization', 'UPDATE') as org_update,
        has_table_privilege('auth_service', 'organization', 'DELETE') as org_delete,
        has_table_privilege('auth_service', 'organization_member', 'DELETE') as member_delete,
        has_table_privilege('auth_service', 'invite', 'UPDATE') as invite_update,
        has_table_privilege('auth_service', 'project', 'SELECT') as project_select
    `;

    expect(row).toEqual({
      auth_select: true,
      auth_delete: true,
      org_update: true,
      org_delete: false,
      member_delete: true,
      invite_update: true,
      project_select: false,
    });
  });

  it('installs the tenant triggers', async () => {
    const rows = await sql<{ tgname: string }[]>`
      select t.tgname
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where not t.tgisinternal
        and (
          (n.nspname = 'auth' and c.relname = 'users')
          or (
            n.nspname = 'public'
            and c.relname in ('organization', 'organization_member', 'invite')
          )
        )
      order by t.tgname
    `;

    expect(rows.map((row) => row.tgname)).toEqual([
      'trg_auth_user_created',
      'trg_invite_active_org',
      'trg_org_member_active_org',
      'trg_org_member_last_owner_delete',
      'trg_org_member_last_owner_update',
      'trg_org_slug_immutable',
    ]);
  });

  it('creates a personal organization when a user is inserted', async () => {
    const user = await createUser('owner@example.com', 'Owner');
    const org = await personalOrg(user.id);

    expect(org.role).toBe('owner');
    expect(org.name).toBe('Owner');
    expect(org.slug).toHaveLength(20);
  });

  it('protects the last owner and allows removal after archiving', async () => {
    const user = await createUser('last-owner@example.com', 'Last Owner');
    const org = await personalOrg(user.id);

    await expect(
      sql`delete from organization_member where user_id = ${user.id}`
    ).rejects.toThrow(/last_owner/);

    await sql`
      update organization
      set status = 'closed', deleted_at = now()
      where id = ${org.id}
    `;

    await sql`delete from organization_member where user_id = ${user.id}`;

    const rows = await sql<{ count: string }[]>`
      select count(*)::text as count
      from organization_member
      where organization_id = ${org.id}
    `;
    expect(rows[0].count).toBe('0');
  });

  it('blocks joins and invitations for archived organizations', async () => {
    const owner = await createUser('archived-owner@example.com', 'Owner');
    const guest = await createUser('archived-guest@example.com', 'Guest');
    const org = await personalOrg(owner.id);

    await sql`
      update organization
      set status = 'closed', deleted_at = now()
      where id = ${org.id}
    `;

    await expect(
      sql`
        insert into organization_member (organization_id, user_id, role)
        values (${org.id}, ${guest.id}, 'viewer')
      `
    ).rejects.toThrow(/org_archived/);

    await expect(
      sql`
        insert into invite (organization_id, email, role, expires_at, inviter_id)
        values (
          ${org.id},
          'guest@example.com',
          'viewer',
          now() + interval '7 days',
          ${owner.id}
        )
      `
    ).rejects.toThrow(/org_archived/);
  });

  it('keeps the organization slug immutable', async () => {
    const user = await createUser('slug-owner@example.com', 'Owner');
    const org = await personalOrg(user.id);

    await expect(
      sql`
        update organization
        set slug = '01234567890123456789'
        where id = ${org.id}
      `
    ).rejects.toThrow(/slug_immutable/);
  });

  it('can calculate membership without the removed soft-delete column', async () => {
    const user = await createUser('role-check@example.com', 'Role Check');
    const org = await personalOrg(user.id);

    const rows = await sql.begin(async (tx) => {
      await tx`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: user.id })},
          true
        )
      `;
      return tx<{ ok: boolean }[]>`
        select auth.has_org_role(
          ${org.id}::uuid,
          array['owner', 'admin']::text[]
        ) as ok
      `;
    });
    expect(rows[0].ok).toBe(true);
  });
});
