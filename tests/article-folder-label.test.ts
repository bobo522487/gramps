import { describe, expect, it } from 'vitest';
import type { ArticleFolderNode } from '@/components/article/types';
import {
  folderLabel,
  folderPickerOptions,
  UNFILED_FOLDER_ID,
} from '@/components/article/types';

/**
 * FR-032：搜索命中要能看出所属分类。列表行的分类标签由这个纯函数算，
 * 所以把它单独钉住，免得「显示成空白」这种问题只在浏览器里看得见。
 */

/** 扁平单层：分类没有层级，picker label 就是分类名本身。 */
const folders: ArticleFolderNode[] = [
  { id: 'f1', name: '谱序', count: 2 },
  { id: 'f2', name: '旧谱序', count: 1 },
  { id: 'f3', name: '传记', count: 0 },
];
const options = folderPickerOptions(folders);

describe('folderLabel（列表行分类标签）', () => {
  it('null 与哨兵值都显示「未分类」', () => {
    expect(folderLabel(options, null)).toBe('未分类');
    expect(folderLabel(options, UNFILED_FOLDER_ID)).toBe('未分类');
  });

  it('命中分类时显示不带缩进的名字', () => {
    expect(folderLabel(options, 'f3')).toBe('传记');
    // 分类已扁平，picker label 不应再带全角空格缩进。
    expect(options.find((option) => option.id === 'f2')?.label).toBe('旧谱序');
    expect(folderLabel(options, 'f2')).toBe('旧谱序');
  });

  it('分类查不到时回落到「未分类」，不显示空白', () => {
    expect(folderLabel(options, 'deleted-folder')).toBe('未分类');
    expect(folderLabel([], 'f1')).toBe('未分类');
  });
});
