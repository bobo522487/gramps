import { describe, expect, it } from 'vitest';
import { type FolderOption, folderOptions } from '@/components/lineage/types';

const folders: FolderOption[] = [
  { id: 'a', name: '甲', parentId: null },
  { id: 'b', name: '乙', parentId: 'a' },
  { id: 'c', name: '丙', parentId: 'a' },
  { id: 'd', name: '丁', parentId: 'missing' }, // orphan: parent not in the list
];

describe('folderOptions', () => {
  it('indents by depth and promotes orphans to the top level', () => {
    expect(folderOptions(folders)).toEqual([
      { id: 'a', label: '甲' },
      { id: 'b', label: '— 乙' },
      { id: 'c', label: '— 丙' },
      { id: 'd', label: '丁' },
    ]);
  });

  it('returns an empty list for an empty project', () => {
    expect(folderOptions([])).toEqual([]);
  });
});
