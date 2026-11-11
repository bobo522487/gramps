import { describe, expect, it } from 'vitest';
import { toNodeViewRows } from '@/lib/db/queries/nodes';

const base = {
  id: 'n1',
  path: '0010',
  parentPath: null,
  kind: 'primary',
  displayName: null,
  primaryName: '实',
  surname: '陈',
};

describe('toNodeViewRows sex', () => {
  it('keeps the database sex value', () => {
    const [row] = toNodeViewRows([{ ...base, sex: 'male' }]);
    expect(row?.sex).toBe('male');
  });

  it('does not collapse female, other, or unknown into one flag', () => {
    const rows = toNodeViewRows([
      { ...base, id: 'f', sex: 'female' },
      { ...base, id: 'o', path: '0020', sex: 'other' },
      { ...base, id: 'u', path: '0030', sex: 'unknown' },
    ]);
    expect(rows.map((row) => row.sex)).toEqual(['female', 'other', 'unknown']);
  });

  it('does not invent a surname by cutting the last character', () => {
    const [row] = toNodeViewRows([
      {
        ...base,
        surname: '司马',
        primaryName: '相如',
        sex: 'male',
      },
    ]);
    expect(row?.surname).toBe('司马');
    expect(row?.name).toBe('相如');
    expect(row?.fullName).toBe('司马相如');
  });
});
