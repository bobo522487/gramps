import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getOrgProjectsRoute } from '@/app/api/orgs/[orgId]/projects/route';
import { GET as getOrgsRoute } from '@/app/api/orgs/route';
import { GET as getUserRoute } from '@/app/api/user/route';
import { signSessionFor } from '../helpers/auth';
import {
  addMember,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const session = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  headers: async () => {
    const headers = new Headers();
    if (session.cookie) {
      headers.set('cookie', session.cookie);
    }
    return headers;
  },
}));

beforeEach(() => {
  session.cookie = undefined;
});

async function signIn(user: { email: string }) {
  session.cookie = await signSessionFor(user.email);
}

describe('read-only API authentication', () => {
  it('returns 401 from /api/user without a session', async () => {
    const response = await getUserRoute(
      new Request('http://localhost/api/user')
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 from /api/orgs without a session', async () => {
    const response = await getOrgsRoute(
      new Request('http://localhost/api/orgs')
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 from the project list without a session', async () => {
    const response = await getOrgProjectsRoute(
      new Request(
        'http://localhost/api/orgs/00000000-0000-0000-0000-000000000000/projects'
      ),
      {
        params: Promise.resolve({
          orgId: '00000000-0000-0000-0000-000000000000',
        }),
      }
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});

describe('read-only API contracts', () => {
  it('returns only the session user DTO', async () => {
    const user = await createUser({ name: '陈实' });
    await signIn(user);

    const response = await getUserRoute(
      new Request('http://localhost/api/user')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: user.id,
      name: '陈实',
      email: user.email,
    });
    expect(response.headers.get('x-request-id')).toBeTruthy();
  });

  it('lists only the organizations the caller belongs to', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const personal = await getPersonalOrg(alice.id);
    const joined = await createOrganization({ name: '加入的组织' });
    const foreign = await getPersonalOrg(bob.id);
    await addMember({
      userId: alice.id,
      organizationId: joined.id,
      role: 'editor',
    });
    await signIn(alice);

    const response = await getOrgsRoute(
      new Request('http://localhost/api/orgs')
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: string;
      name: string;
      slug: string;
      role: string;
    }[];

    expect(body.map((row) => row.id)).toEqual([
      personal?.organization.id,
      joined.id,
    ]);
    expect(body.find((row) => row.id === joined.id)?.role).toBe('editor');
    expect(body.map((row) => row.id)).not.toContain(foreign?.organization.id);
    expect(Object.keys(body[0]).sort()).toEqual(['id', 'name', 'role', 'slug']);
  });

  it('returns 404 for a malformed organization id and 403 for a non-member', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const bobOrg = await getPersonalOrg(bob.id);
    await signIn(alice);

    const malformed = await getOrgProjectsRoute(
      new Request('http://localhost/api/orgs/not-a-uuid/projects'),
      { params: Promise.resolve({ orgId: 'not-a-uuid' }) }
    );
    expect(malformed.status).toBe(404);

    const forbidden = await getOrgProjectsRoute(
      new Request(
        `http://localhost/api/orgs/${bobOrg?.organization.id}/projects`
      ),
      {
        params: Promise.resolve({
          orgId: bobOrg?.organization.id as string,
        }),
      }
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: 'Forbidden' });
  });

  it('lists project DTOs for a member without internal fields', async () => {
    const alice = await createUser();
    const personal = await getPersonalOrg(alice.id);
    const project = await createProject({
      orgId: personal?.organization.id as string,
      createdBy: alice.id,
      name: '颍川陈氏',
    });
    await signIn(alice);

    const response = await getOrgProjectsRoute(
      new Request(
        `http://localhost/api/orgs/${personal?.organization.id}/projects`
      ),
      {
        params: Promise.resolve({
          orgId: personal?.organization.id as string,
        }),
      }
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      id: project.id,
      name: '颍川陈氏',
      ref: project.ref,
    });
  });
});
