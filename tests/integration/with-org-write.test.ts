import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { queryRows, withOrg } from '@/lib/db/drizzle';
import { organizations } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createOrganization,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

/** Owner of a fresh org; the registration trigger already made their personal org. */
async function ownerScope() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) throw new Error('registration trigger did not create an org');
  return { user, organization: personal.organization };
}

/** A separate user who is only a viewer in a shared org. */
async function viewerScope() {
  const owner = await createUser();
  const organization = await createOrganization();
  await addMember({
    userId: owner.id,
    organizationId: organization.id,
    role: 'owner',
  });
  const viewer = await createUser();
  await addMember({
    userId: viewer.id,
    organizationId: organization.id,
    role: 'viewer',
  });
  return { viewer, organization };
}

describe('withOrgWrite', () => {
  it('runs the callback when the caller has the permission', async () => {
    const { user, organization } = await ownerScope();
    const result = await withOrgWrite(
      user.id,
      organization.id,
      'lineage.write',
      async (tx) =>
        (await queryRows<{ ok: number }>(tx, sql`select 1 as ok`))[0]
    );
    expect(result).toEqual({ ok: 1 });
  });

  it('refuses before running the callback for a viewer', async () => {
    const { viewer, organization } = await viewerScope();
    const spy = vi.fn();
    const result = await withOrgWrite(
      viewer.id,
      organization.id,
      'lineage.write',
      spy
    );
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses writes to an archived organization', async () => {
    const { user, organization } = await ownerScope();
    await getTestDb()
      .update(organizations)
      .set({ status: 'closed' })
      .where(eq(organizations.id, organization.id));

    const spy = vi.fn();
    const result = await withOrgWrite(
      user.id,
      organization.id,
      'lineage.write',
      spy
    );
    expect(result).toEqual({ ok: false, reason: 'org_archived' });
    expect(spy).not.toHaveBeenCalled();
  });

  // Review Focus #4: the refused transaction must not leak its role/claims to
  // the next borrower of the pooled connection. A bare "reads one row" assertion
  // would pass even with a session-level SET; assert the actual settings seen
  // from the *next* request instead.
  it('leaves no role or claims residue after an early refusal', async () => {
    const { viewer, organization } = await viewerScope();
    await withOrgWrite(
      viewer.id,
      organization.id,
      'lineage.write',
      async () => 'unreachable'
    );

    const { user: owner, organization: ownOrg } = await ownerScope();
    const rows = await withOrg(owner.id, (tx) =>
      tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, ownOrg.id))
    );
    expect(rows).toHaveLength(1);

    const settings = await withOrg(owner.id, (tx) =>
      queryRows<{ role: string; sub: string }>(
        tx,
        // 目标态 GUC 是 app.user_id（withOrg 用 set_config(..., true) 注入），
        // 旧 request.jwt.claims 已随 Better Auth 插件拆除一并退役。
        sql`select current_user as role,
              current_setting('app.user_id', true) as sub`
      )
    );
    expect(settings[0]).toEqual({ role: 'genealogy_app', sub: owner.id });

    // And the refused caller's own claims never saw another user's sub.
    const viewerSettings = await withOrg(viewer.id, (tx) =>
      queryRows<{ sub: string }>(
        tx,
        sql`select current_setting('app.user_id', true) as sub`
      )
    );
    expect(viewerSettings[0]?.sub).toBe(viewer.id);
  });
});
