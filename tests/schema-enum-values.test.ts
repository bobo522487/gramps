import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { enumValues } from '@/lib/db/schema/shared';

/**
 * `enumValues` 渲染 CHECK 约束的字面量闭集，行为被多张表的 CHECK 约束间接依赖
 * （见 tests/integration/fact-person.test.ts、fact-event.test.ts 的
 * readCheckConstraintValues 校验）。这里补一层**单元**测试：一份实现替掉 5 份
 * 复制后，转义这类新加的安全属性也要有单测兜住。
 */
const dialect = new PgDialect();
function render(values: readonly string[]): string {
  return dialect.sqlToQuery(enumValues(values)).sql;
}

describe('enumValues', () => {
  it('把闭集渲染成带引号的字面量列表', () => {
    const out = render(['primary', 'repeat', 'annotation']);
    expect(out).toContain("'primary'");
    expect(out).toContain("'repeat'");
    expect(out).toContain("'annotation'");
  });

  it('嵌入的单引号必须翻倍转义，否则会破坏字面量边界', () => {
    // 当前值都来自 lib/genealogy/constants.ts 的英文常量，安全；但一旦将来有人
    // 把含撇号的名字/枚举放进来，未转义就会生成语法错误的 DDL（且拖到迁移执行期才爆）。
    const out = render(["O'Brien", "don't"]);
    expect(out).toContain("'O''Brien'");
    expect(out).toContain("'don''t'");
  });
});
