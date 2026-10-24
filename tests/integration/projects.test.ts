import { and, count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityType, activityLogs, projects } from '@/lib/db/schema';
import {
  createProjectInTransaction,
  type ProjectUpdates,
  updateProjectInTransaction,
} from '@/lib/db/services';
import { getTestDb } from '../helpers/db';
import {
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

const ids = vi.hoisted(() => ({ queued: [] as string[] }));

vi.mock('@/lib/ids', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ids')>();
  return {
    ...actual,
    generatePublicId: () => ids.queued.shift() ?? actual.generatePublicId(),
  };
});

beforeEach(() => {
  ids.queued.length = 0;
});

const projectInput = {
  name: '颍川陈氏云谱',
  surname: '陈',
  themeName: '颍川陈氏宗谱',
  countriesRegions: '中国福建',
  status: 'in_progress' as const,
  importance: 3,
  notes: '测试备注',
};

async function setup() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('expected the signup trigger to create a personal org');
  }
  return { user, organization: personal.organization };
}

describe('createProjectInTransaction public refs', () => {
  it('creates a project with a generated 20-character ref and logs it', async () => {
    const { user, organization } = await setup();

    const result = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.ref).toMatch(/^[0-9a-z]{20}$/);
    expect(result.project).toMatchObject({
      name: '颍川陈氏云谱',
      surname: '陈',
      themeName: '颍川陈氏宗谱',
      countriesRegions: '中国福建',
      status: 'in_progress',
      importance: 3,
      notes: '测试备注',
    });

    const logRows = await getTestDb()
      .select({ action: activityLogs.action })
      .from(activityLogs)
      .where(
        and(
          eq(activityLogs.orgId, organization.id),
          eq(activityLogs.action, ActivityType.CREATE_PROJECT)
        )
      );
    expect(logRows).toHaveLength(1);
  });

  it('regenerates the ref when the first attempt collides', async () => {
    const { user, organization } = await setup();
    const existing = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    ids.queued.push(existing.ref);

    const result = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.ref).not.toBe(existing.ref);
    expect(result.project.ref).toMatch(/^[0-9a-z]{20}$/);
  });

  it('reports a conflict after three ref collisions', async () => {
    const { user, organization } = await setup();
    const existing = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    ids.queued.push(existing.ref, existing.ref, existing.ref);

    const result = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });

    expect(result).toEqual({ ok: false, reason: 'conflict' });

    const [row] = await getTestDb()
      .select({ value: count() })
      .from(projects)
      .where(eq(projects.orgId, organization.id));
    expect(row?.value).toBe(1);
  });
});

describe('updateProjectInTransaction metadata', () => {
  it('updates mutable fields and ignores crafted immutable fields', async () => {
    const { user, organization } = await setup();
    const created = await createProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      input: projectInput,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const crafted = {
      name: '颍川陈氏新谱',
      countriesRegions: '中国广东',
      status: 'completed',
      importance: 5,
      notes: '已完成续修',
      surname: '李',
      themeName: '李氏宗谱',
    } as unknown as ProjectUpdates;

    const result = await updateProjectInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: created.project.id,
      updates: crafted,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project).toMatchObject({
      name: '颍川陈氏新谱',
      countriesRegions: '中国广东',
      status: 'completed',
      importance: 5,
      notes: '已完成续修',
      surname: '陈',
      themeName: '颍川陈氏宗谱',
    });
  });
});
