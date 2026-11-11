import { describe, expect, it } from 'vitest';
import { orgDirectoryItems } from '@/components/console/org-directory';

describe('orgDirectoryItems', () => {
  it('lists the organization directory in NocoDB order', () => {
    const items = orgDirectoryItems({
      slug: 'chen',
      projectCount: 2,
      memberCount: 4,
    });

    expect(items.map((item) => item.label)).toEqual([
      '云谱空间',
      '团队',
      '组织设置',
    ]);
    expect(items[0]).toMatchObject({
      href: '/dashboard/org/chen',
      exact: true,
      count: 2,
    });
    expect(items[1]).toMatchObject({
      href: '/dashboard/org/chen/team',
      count: 4,
    });
    expect(items[2]?.count).toBeUndefined();
  });

  it('omits counts when the layout did not inject them', () => {
    const items = orgDirectoryItems({ slug: 'chen' });
    expect(items.every((item) => item.count === undefined)).toBe(true);
  });
});
