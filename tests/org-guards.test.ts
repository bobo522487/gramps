import { describe, expect, it, vi } from 'vitest';
import { requireOrgPermission } from '@/lib/db/guards';

vi.mock('@/lib/auth/permissions', async (orig) => ({
  ...(await orig<typeof import('@/lib/auth/permissions')>()),
  getOrgRoleInTx: vi.fn(),
}));
const { getOrgRoleInTx } = await import('@/lib/auth/permissions');

describe('requireOrgPermission', () => {
  it('returns false when the caller is not a member', async () => {
    vi.mocked(getOrgRoleInTx).mockResolvedValue(null);
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(false);
  });

  it('returns false for viewer on a write permission and true for editor', async () => {
    vi.mocked(getOrgRoleInTx).mockResolvedValue('viewer');
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(false);
    vi.mocked(getOrgRoleInTx).mockResolvedValue('editor');
    await expect(
      requireOrgPermission({} as never, 'u1', 'o1', 'lineage.write')
    ).resolves.toBe(true);
  });
});
