import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli as runBackfill } from '@/data/backfill-fact-layer';
import { runCli as runReconcile } from '@/data/reconcile-fact-layer';
import { getTestSql } from '../helpers/db';
import {
  addMember,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
} from '../helpers/factories';

// The two CLIs are the only way an operator runs the backfill, so their exit
// codes are a contract: a wrapper script has to tell "the reconciliation found
// a diff" (1) from "the tool did not run" (3) without parsing stdout. Both
// entry points are `runCli(argv)` returning the code, so this file can call
// them in-process — `tsx` is not a dependency and the suite must not spawn it.

/** Owner of a fresh organization plus one project and one lineage in it. */
async function seedTree() {
  const user = await createUser();
  const organization = await createOrganization();
  await addMember({
    userId: user.id,
    organizationId: organization.id,
    role: 'owner',
  });
  const project = await createProject({
    orgId: organization.id,
    createdBy: user.id,
  });
  const lineage = await createLineage({
    orgId: organization.id,
    projectId: project.id,
    createdBy: user.id,
  });
  return {
    orgId: organization.id,
    projectId: project.id,
    lineageId: lineage.id,
    createdBy: user.id,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

function silence() {
  return {
    log: vi.spyOn(console, 'log').mockImplementation(() => undefined),
    error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
  };
}

describe('data:backfill:fact exit codes', () => {
  it('returns 2 for usage errors and prints the usage text', async () => {
    const output = silence();
    expect(await runBackfill([])).toBe(2);
    expect(await runBackfill(['--org', 'not-a-uuid'])).toBe(2);
    expect(String(output.error.mock.calls[0]?.[0])).toContain('usage:');
  });

  it('returns 0 and prints the summary for a fresh organization', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
      birthYear: 1900,
    });
    const output = silence();

    expect(await runBackfill(['--org', orgId])).toBe(0);

    const lines = output.log.mock.calls.map((call) => String(call[0]));
    const summary = lines
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { summary?: { persons: number } })
      .find((row) => row.summary !== undefined);
    expect(summary?.summary?.persons).toBe(1);
  });

  it('returns 1, not 3, when the organization is already backfilled', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({ orgId, lineageId, createdBy, generation: 1, path: 'a' });
    silence();

    expect(await runBackfill(['--org', orgId])).toBe(0);
    // Already backfilled is a *finding*, not an infrastructure failure: the
    // operator asked for something the tool refuses on purpose.
    expect(await runBackfill(['--org', orgId])).toBe(1);
  });

  it('returns 3 when the database cannot be reached', async () => {
    const { orgId } = await seedTree();
    silence();
    const previous = process.env.POSTGRES_URL_DIRECT;
    process.env.POSTGRES_URL_DIRECT =
      'postgres://postgres:postgres@127.0.0.1:1/gramps_test';
    try {
      expect(await runBackfill(['--org', orgId])).toBe(3);
    } finally {
      if (previous === undefined) {
        delete process.env.POSTGRES_URL_DIRECT;
      } else {
        process.env.POSTGRES_URL_DIRECT = previous;
      }
    }
  });
});

describe('data:reconcile:fact exit codes', () => {
  it('returns 2 for usage errors', async () => {
    silence();
    expect(await runReconcile(['--org'])).toBe(2);
  });

  it('returns 0 and says ok for a backfilled organization', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({
      orgId,
      lineageId,
      createdBy,
      generation: 1,
      path: 'a',
      name: '甲',
      birthYear: 1900,
    });
    const output = silence();
    expect(await runBackfill(['--org', orgId])).toBe(0);
    // `vi.spyOn` returns the same mock for an already-spied method, so the
    // backfill's two JSON lines are in the same call list; clear it.
    output.log.mockClear();
    expect(await runReconcile(['--org', orgId])).toBe(0);
    const lines = output.log.mock.calls.map((call) => String(call[0]));
    expect(lines).toContain('reconcile ok: 1 organization');
    const summary = lines
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as { summary?: { checks: number } })
      .find((row) => row.summary !== undefined);
    expect(summary?.summary?.checks).toBe(14);
  });

  it('returns 1 when a check differs', async () => {
    const { orgId, lineageId, createdBy } = await seedTree();
    await createNode({ orgId, lineageId, createdBy, generation: 1, path: 'a' });
    const output = silence();
    expect(await runBackfill(['--org', orgId])).toBe(0);
    output.log.mockClear();
    await getTestSql()`
      UPDATE person SET primary_name_id = NULL WHERE organization_id = ${orgId}`;

    expect(await runReconcile(['--org', orgId])).toBe(1);
  });

  it('returns 3 when the database cannot be reached', async () => {
    const { orgId } = await seedTree();
    silence();
    const previous = process.env.POSTGRES_URL_DIRECT;
    process.env.POSTGRES_URL_DIRECT =
      'postgres://postgres:postgres@127.0.0.1:1/gramps_test';
    try {
      expect(await runReconcile(['--org', orgId])).toBe(3);
    } finally {
      if (previous === undefined) {
        delete process.env.POSTGRES_URL_DIRECT;
      } else {
        process.env.POSTGRES_URL_DIRECT = previous;
      }
    }
  });
});
