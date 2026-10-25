import { describe, expect, it } from 'vitest';
import {
  buildLineageTree,
  filterLineageTree,
} from '@/components/lineage/lineage-tree';

const lineage = {
  id: 'l1',
  name: '颍川陈氏',
  surname: '陈',
  hallCode: null,
  nodeCount: 0,
  folderId: null,
  region: '中国/福建/漳州',
};

describe('filterLineageTree', () => {
  it('matches a lineage by its region', () => {
    const tree = buildLineageTree([], [lineage]);
    expect(filterLineageTree(tree, '漳州').unfiled).toHaveLength(1);
    expect(filterLineageTree(tree, '北京').unfiled).toHaveLength(0);
  });

  it('tolerates lineages created before region existed', () => {
    const tree = buildLineageTree([], [{ ...lineage, region: null }]);
    expect(filterLineageTree(tree, '陈').unfiled).toHaveLength(1);
  });
});
