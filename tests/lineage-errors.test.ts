import { describe, expect, it } from 'vitest';
import {
  deleteLineageError,
  LINEAGE_ERRORS,
  lineageError,
} from '@/lib/lineage/lineage-errors';

describe('lineage error messages', () => {
  it('maps every transaction reason to a Chinese message', () => {
    for (const reason of Object.keys(LINEAGE_ERRORS)) {
      const { error } = lineageError(reason as keyof typeof LINEAGE_ERRORS);
      expect(error.length).toBeGreaterThan(0);
    }
  });

  it('keeps 删除谱系 failure distinct from 编辑谱系 failure', () => {
    // 编辑者有写权限、只是不能删谱系：两条文案必须不同，否则用户看到错的理由。
    expect(deleteLineageError('forbidden')).toEqual({
      error: '只有所有者或管理员可以删除谱系',
    });
    expect(lineageError('forbidden')).toEqual({
      error: '你没有编辑谱系的权限',
    });
  });

  it('falls back to the shared message for non-permission reasons', () => {
    expect(deleteLineageError('referenced')).toEqual({
      error: LINEAGE_ERRORS.referenced,
    });
    expect(deleteLineageError('not_found')).toEqual({
      error: LINEAGE_ERRORS.not_found,
    });
  });
});
