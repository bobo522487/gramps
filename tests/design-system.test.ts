import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/api/orgs/[orgId]/projects/route';

const apiDirectory = vi.hoisted(() => ({
  role: null as string | null,
  user: null as { id: number } | null,
  projects: [] as { id: number; name: string; ref: string; status: string }[],
}));

vi.mock('@/lib/auth/context', () => ({
  getSessionUser: async () => apiDirectory.user,
}));

vi.mock('@/lib/db/queries/projects', () => ({
  getProjects: async () => apiDirectory.projects,
}));

vi.mock('@/lib/db/queries/organizations', () => ({
  getOrgsForUser: async (userId: number) =>
    apiDirectory.role && apiDirectory.user?.id === userId
      ? [{ organization: { id: 1 }, role: apiDirectory.role }]
      : [],
  getOrgRoleForUser: async (userId: number) =>
    apiDirectory.role && apiDirectory.user?.id === userId
      ? apiDirectory.role
      : null,
}));

const colorLiterals =
  /zinc-|emerald-|#181818|#121212|gray-[0-9]|orange-[0-9]|red-[0-9]|green-[0-9]/;

function sourceFiles(dir: string): string[] {
  const root = resolve(import.meta.dirname, dir);
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(`${dir}/${entry}`);
    }
    return /\.(ts|tsx)$/.test(entry) ? [path] : [];
  });
}

describe('design token boundary', () => {
  it('keeps raw color literals out of pages and console composition', () => {
    const offenders: string[] = [];
    for (const dir of [
      '../app/(dashboard)',
      '../app/(login)',
      '../components/console',
      '../components/org',
      '../components/project',
    ]) {
      for (const file of sourceFiles(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (colorLiterals.test(line)) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('status mapping', () => {
  it('maps db statuses, health and roles to Chinese labels', async () => {
    const { regionLabel, roleLabel, statusLabel, statusVariant } = await import(
      '@/lib/ui/status'
    );
    expect(statusVariant('ACTIVE')).toBe('success');
    expect(statusVariant('HEALTHY')).toBe('success');
    expect(statusVariant('owner')).toBe('success');
    expect(statusVariant('PAUSED')).toBe('warning');
    expect(statusVariant('DEGRADED')).toBe('warning');
    expect(statusVariant('member')).toBe('info');
    expect(statusVariant('ARCHIVED')).toBe('secondary');
    // Unknown values stay neutral instead of silently reading as healthy
    expect(statusVariant('BOGUS')).toBe('outline');

    expect(statusLabel('ACTIVE')).toBe('活跃');
    expect(statusLabel('PAUSED')).toBe('已暂停');
    expect(statusLabel('ARCHIVED')).toBe('已归档');
    expect(statusLabel('HEALTHY')).toBe('健康');
    expect(statusLabel('DEGRADED')).toBe('降级');
    expect(statusLabel('BOGUS')).toBe('BOGUS');
    expect(roleLabel('owner')).toBe('所有者');
    expect(roleLabel('member')).toBe('成员');
    expect(regionLabel('us-east-1')).toBe('美国东部');
    expect(regionLabel('ap-southeast-1')).toBe('新加坡');
    expect(regionLabel('moon-1')).toBe('moon-1');
  });

  it('no longer surfaces plan tier or slug in project views', () => {
    const workspace = readFileSync(
      resolve(
        import.meta.dirname,
        '../components/project/project-workspace.tsx'
      ),
      'utf8'
    );
    expect(workspace).not.toMatch(/\btier\b/);
    expect(workspace).not.toMatch(/\bslug\b/);
  });
});

describe('org-scoped project list api', () => {
  const call = async (orgId: string) =>
    GET(new Request('http://localhost'), {
      params: Promise.resolve({ orgId }),
    });

  it('returns 401 without a session', async () => {
    apiDirectory.user = null;
    apiDirectory.role = 'owner';
    expect((await call('1')).status).toBe(401);
  });

  it('returns 403 for a non-member of the requested org', async () => {
    apiDirectory.user = { id: 7 };
    apiDirectory.role = null;
    apiDirectory.projects = [
      { id: 1, name: 'Docs', ref: 'docs0000000000000001', status: 'ACTIVE' },
    ];
    const response = await call('1');
    expect(response.status).toBe(403);
    // The project rows must not be disclosed on the denial path
    expect(await response.json()).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 for a non-numeric org id', async () => {
    apiDirectory.user = { id: 7 };
    apiDirectory.role = 'member';
    expect((await call('nope')).status).toBe(404);
  });

  it('lists projects for a member, without the owner-only fields', async () => {
    apiDirectory.user = { id: 7 };
    apiDirectory.role = 'member';
    apiDirectory.projects = [
      {
        id: 3,
        name: 'Docs API',
        ref: 'docsapi0000000000001',
        status: 'ACTIVE',
      },
    ];
    const response = await call('1');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: 3,
        name: 'Docs API',
        ref: 'docsapi0000000000001',
        status: 'ACTIVE',
      },
    ]);
  });
});
