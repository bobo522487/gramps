import { and, count, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityType, activityLogs, projects } from '@/lib/db/schema';
import { createProjectInTransaction } from '@/lib/db/services';
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
  primaryName: '陈氏',
  primarySurname: '陈',
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
