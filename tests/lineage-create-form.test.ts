import { describe, expect, it } from 'vitest';
import {
  canSubmitLineage,
  hasInheritedSurname,
  resolveSelectedFolderId,
} from '@/lib/lineage/create-form';

const folders = [
  { id: 'f1', name: '卷一', parentId: null },
  { id: 'f2', name: '卷二', parentId: null },
];

describe('resolveSelectedFolderId', () => {
  it('keeps a selection that still exists', () => {
    expect(resolveSelectedFolderId(folders, 'f2')).toBe('f2');
  });

  it('falls back to empty when the selected folder was deleted meanwhile', () => {
    expect(resolveSelectedFolderId(folders, 'gone')).toBe('');
  });

  it('returns empty when the project has no folders at all', () => {
    expect(resolveSelectedFolderId([], 'f1')).toBe('');
  });
});

describe('canSubmitLineage', () => {
  const base = { name: '颍川陈氏', region: '中国/福建', folderId: 'f1' };

  it('accepts a complete form', () => {
    expect(canSubmitLineage(base)).toBe(true);
  });

  it('rejects blank name, region or folder', () => {
    expect(canSubmitLineage({ ...base, name: '   ' })).toBe(false);
    expect(canSubmitLineage({ ...base, region: '   ' })).toBe(false);
    expect(canSubmitLineage({ ...base, folderId: '' })).toBe(false);
  });
});

describe('hasInheritedSurname', () => {
  it('treats blank inherited surnames as missing', () => {
    expect(hasInheritedSurname('陈')).toBe(true);
    expect(hasInheritedSurname('')).toBe(false);
    expect(hasInheritedSurname('   ')).toBe(false);
  });
});
