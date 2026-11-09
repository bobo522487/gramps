import { describe, expect, it } from 'vitest';
import {
  EVENT_KIND_VALUES,
  PERSON_NAME_TYPE_VALUES,
  PERSON_SEX_VALUES,
} from '@/lib/genealogy/constants';

// 阶段 A′ 后只剩附录 A.3 的三组 CHECK 值域；旧的 13 组（存活状态、隐私、
// GEDCOM 事件类型、日期精度等）连同它们对应的列一并退役。
const ALL = {
  PERSON_SEX_VALUES,
  PERSON_NAME_TYPE_VALUES,
  EVENT_KIND_VALUES,
};

describe('genealogy constants (target model, appendix A.3)', () => {
  it('has no duplicate values in any closed domain', () => {
    for (const [name, values] of Object.entries(ALL)) {
      expect(new Set(values).size, name).toBe(values.length);
    }
  });

  it('pins the exact value sets the target DDL enforces', () => {
    expect([...PERSON_SEX_VALUES]).toEqual([
      'male',
      'female',
      'other',
      'unknown',
    ]);
    expect([...PERSON_NAME_TYPE_VALUES]).toEqual([
      'given',
      'courtesy',
      'art',
      'milk',
      'genealogy',
      'posthumous',
      'other',
    ]);
    expect([...EVENT_KIND_VALUES]).toEqual([
      'birth',
      'death',
      'burial',
      'marriage',
      'divorce',
      'adoption',
      'heir_transfer',
      'migration',
      'office',
      'exam',
      'other',
    ]);
  });

  it('keeps every value a safe lower_snake_case SQL literal', () => {
    // schema 用 sql.raw 把这些值拼进 CHECK；任何引号 / 大写 / 连字符都会
    // 破坏生成的 SQL 字面量，也会让常量与 DDL 的 CHECK 漂移。
    for (const [name, values] of Object.entries(ALL)) {
      for (const value of values) {
        expect(value, `${name}.${value}`).toMatch(/^[a-z_]+$/);
      }
    }
  });
});
