import { describe, expect, it } from 'vitest';
import { type FolderOption, folderOptions } from '@/components/lineage/types';

/** 扁平单层：分类之间没有父子关系，选项只按名称排序。 */
const folders: FolderOption[] = [
  { id: 'a', name: '丙' },
  { id: 'b', name: '甲' },
  { id: 'c', name: '丁' },
  { id: 'd', name: '乙' },
];

describe('folderOptions', () => {
  it('按名称（zh-CN 拼音序）平铺，不带深度缩进', () => {
    expect(folderOptions(folders)).toEqual([
      { id: 'a', label: '丙' },
      { id: 'c', label: '丁' },
      { id: 'b', label: '甲' },
      { id: 'd', label: '乙' },
    ]);
  });

  it('label 就是分类名，不带 「— 」之类的缩进前缀', () => {
    for (const option of folderOptions(folders)) {
      expect(option.label).not.toMatch(/^[—\s\u3000]/);
    }
  });

  it('returns an empty list for an empty project', () => {
    expect(folderOptions([])).toEqual([]);
  });
});
