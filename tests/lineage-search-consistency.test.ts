import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildLineageIndex,
  matchesNode,
  matchLineagePerson,
} from '@/components/lineage/derived';
import type { NodeView } from '@/components/lineage/types';

/**
 * The canvas (`matchesNode`) and the 世系表 (`visibleBlood` in
 * lineage-detail.tsx) filter the same people. They used to carry two separate
 * field lists, and the table's shorter list silently dropped people who only
 * matched 生卒年 / 葬地. These tests pin the single predicate and forbid the
 * table from growing a second field list again.
 */

function node(
  overrides: Partial<NodeView> & { id: string; name: string }
): NodeView {
  const surname = overrides.surname ?? '陈';
  return {
    parentId: null,
    spouseOfId: null,
    role: 'blood',
    generation: 1,
    sort: 0,
    surname,
    // Write-side invariant: fullName = surname + name.
    fullName: `${surname}${overrides.name}`,
    sex: 0,
    courtesy: null,
    namePrefix: null,
    isAlive: false,
    birthText: null,
    deathText: null,
    birthYear: null,
    deathYear: null,
    burialPlace: null,
    biography: null,
    ...overrides,
  };
}

describe('lineage search predicate is single-sourced', () => {
  it('exposes matchesNode as the one shared predicate', () => {
    expect(typeof matchesNode).toBe('function');
  });

  it.each(['birthText', 'deathText', 'burialPlace'] as const)(
    'canvas and table agree on %s (the fields the table used to miss)',
    (field) => {
      const n = node({ id: `n-${field}`, name: '某', [field]: '崇祯十七年' });

      expect(n.fullName).toBe(`${n.surname}${n.name}`);
      expect(matchesNode(n, '崇祯')).toBe(true);

      // Same query, canvas path (index.blood only holds role === 'blood').
      expect(
        matchLineagePerson(buildLineageIndex([n]), '崇祯')?.matchedId
      ).toBe(n.id);
    }
  );

  it('keeps matching 姓名 exactly as before (regression, not a fix)', () => {
    // fullName = surname + name, so the table's old fullName-only check already
    // covered `name`; widening the predicate must not change that behaviour.
    const n = node({ id: 'x', name: '鼎', surname: '王' });
    expect(n.fullName).toBe('王鼎');
    expect(matchesNode(n, '鼎')).toBe(true);
    expect(n.fullName.toLowerCase().includes('鼎')).toBe(true);
    expect(matchLineagePerson(buildLineageIndex([n]), '鼎')?.matchedId).toBe(
      'x'
    );
  });

  it('still returns null when nobody matches', () => {
    const n = node({ id: 'y', name: '守', surname: '林' });
    expect(matchLineagePerson(buildLineageIndex([n]), '不存在')).toBeNull();
  });

  it('leaves no second field list in the 世系表', () => {
    const src = readFileSync('components/lineage/lineage-detail.tsx', 'utf8');

    // Before: 5 per-column `.toLowerCase().includes(needle)` checks in visibleBlood.
    expect(src).not.toMatch(/\.toLowerCase\(\)\.includes\(needle\)/);
    expect(src).toMatch(
      /import \{[^}]*matchesNode[^}]*\} from '@\/components\/lineage\/derived'/
    );
    expect(src).toMatch(/useDeferredValue\(tableQuery\)/);
  });
});
