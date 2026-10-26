import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { queryRows, withOrg } from '@/lib/db/drizzle';
import { organizations } from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';
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
      { userId: user.id, orgId: organization.id, permission: 'lineage.write' },
      async (tx) =>
        (await queryRows<{ ok: number }>(tx, sql`select 1 as ok`))[0]
    );
    expect(result).toEqual({ ok: 1 });
  });

  it('refuses before running the callback for a viewer', async () => {
    const { viewer, organization } = await viewerScope();
    const spy = vi.fn();
    const result = await withOrgWrite(
      {
        userId: viewer.id,
        orgId: organization.id,
        permission: 'lineage.write',
      },
      spy
    );
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
    expect(spy).not.toHaveBeenCalled();
  });

  // Review Focus #4: an early return must not leave role/claims on the pooled connection.
  it('leaves no role or claims residue after an early refusal', async () => {
    const { viewer, organization } = await viewerScope();
    await withOrgWrite(
      {
        userId: viewer.id,
        orgId: organization.id,
        permission: 'lineage.write',
      },
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
  });
});
