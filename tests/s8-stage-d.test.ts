import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function driftStep(): string {
  const ci = read('.github/workflows/ci.yml');
  const start = ci.indexOf('Check migration drift');
  expect(start, 'CI 缺少 Check migration drift 步骤').toBeGreaterThan(-1);
  const next = ci.indexOf('\n      - name:', start + 1);
  return ci.slice(start, next === -1 ? ci.length : next);
}

/** @case 与 @expect 一一对应，且期望只允许 5 位 SQLSTATE / OK / SKIP。 */
function assertFixtureShape(fixture: string): void {
  const cases = [...fixture.matchAll(/^--\s*@case\s+(\S+)\s*$/gm)].map(
    (m) => m[1]
  );
  const expects = [...fixture.matchAll(/^--\s*@expect\s+(\S+)\s*$/gm)].map(
    (m) => m[1]
  );
  expect(expects, '@case 与 @expect 数量不一致').toHaveLength(cases.length);
  for (const value of expects) {
    expect(/^(\d{5}|OK|SKIP)$/.test(value), `非法 @expect：${value}`).toBe(
      true
    );
  }
  for (const id of cases) {
    const body =
      fixture.split(`-- @case ${id}\n`)[1]?.split('-- @case ')[0] ?? '';
    expect(body, `${id} 缺少 @desc`).toContain('-- @desc');
  }
}

describe('阶段 D / T39 迁移漂移门禁', () => {
  test('D-1：CI 能捕获 drizzle-kit 静默报错退出 0 的假绿', () => {
    // drizzle-kit 在列冲突时打印「Interactive prompts require a TTY」却以
    // exit 0 退出、且不生成文件，旧步骤的 `test -z ...` 会空转通过。
    const step = driftStep();
    expect(step).toContain('set -o pipefail');
    expect(step).toContain('tee');
    expect(step).toMatch(/Interactive prompts/);
    expect(step).toContain(
      'test -z "$(git status --porcelain lib/db/migrations)"'
    );
  });

  test('D-2：0000_snapshot.json 的 book 是目标态，不含旧富字段列', () => {
    const snapshot = JSON.parse(
      read('lib/db/migrations/meta/0000_snapshot.json')
    );
    const entry = Object.entries(snapshot.tables).find(([key]) =>
      /\."?book"?$/.test(key)
    );
    expect(entry, 'snapshot 缺少 book 表').toBeDefined();
    const book = entry?.[1] as {
      columns: Record<string, unknown>;
      foreignKeys: Record<string, unknown>;
      indexes: Record<string, unknown>;
    };
    const columns = Object.keys(book.columns);

    expect(columns).toContain('edition_text');
    expect(columns).toContain('compiler_text');
    for (const retired of [
      'name',
      'surname',
      'cover_spec',
      'sort',
      'created_by',
      'hall_code',
      'volume_no',
      'author',
      'compiled_at',
      'back_cover_spec',
    ]) {
      expect(columns, `旧列 ${retired} 不应还在 snapshot 里`).not.toContain(
        retired
      );
    }
    expect(Object.keys(book.foreignKeys)).toContain('book_folder_fk');
    expect(Object.keys(book.indexes)).toContain('book_folder_idx');
  });

  test('D-3：journal 只有 1 条目标态基线', () => {
    const journal = JSON.parse(read('lib/db/migrations/meta/_journal.json'));
    expect(journal.entries).toHaveLength(1);
    expect(journal.entries[0].tag).toBe('0000_target_schema');
  });

  test('D-4 T36/T42：验收脚本、命令与 CI 步骤都落地', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.scripts['verify:target-schema']).toBe(
      'node scripts/verify-target-schema.mjs'
    );
    expect(read('.github/workflows/ci.yml')).toContain(
      'pnpm verify:target-schema'
    );
    const script = read('scripts/verify-target-schema.mjs');
    for (const flag of ['--help', '--ddl', '--assertions', '--security']) {
      expect(script, `缺少 ${flag}`).toContain(flag);
    }
  });

  test('D-5 T38：反例夹具全量覆盖附录 B.2 的 N1–N31', () => {
    const manifest = read('tests/fixtures/target-schema-assertions.md');
    const known = new Set(
      [...manifest.matchAll(/^\|\s*(N\d+)\s*\|/gm)].map((m) => m[1])
    );
    const fixture = read('tests/fixtures/target-schema-negative.sql');
    const cases = [...fixture.matchAll(/^--\s*@case\s+(N\d+)/gm)].map(
      (m) => m[1]
    );
    expect(cases.length).toBeGreaterThanOrEqual(31);
    for (const id of cases) {
      expect(known.has(id), `${id} 不在场景清单里`).toBe(true);
    }
    for (const id of known) {
      expect(cases, `附录 B.2 的 ${id} 没有可执行夹具`).toContain(id);
    }
    assertFixtureShape(fixture);
  });

  test('D-6 T40：性能数字不得作为本地验收结论', () => {
    const script = read('scripts/verify-target-schema.mjs');
    expect(script).toMatch(/skip\(\s*'T40 EXPLAIN \/ Q1 \/ Q3 数字'/);
    expect(script).not.toMatch(/26\.454|42\.930/);
  });

  test('D-7 T41：fail-closed 三项断言齐备', () => {
    const script = read('scripts/verify-target-schema.mjs');
    expect(script).toContain('22023'); // 伪造 pg_temp.invite
    expect(script).toContain('42501'); // 未授权角色
    expect(script).toContain('fail-closed'); // SET LOCAL 同事务
  });

  test('D-8 T38：正例夹具全量覆盖附录 B.1 的 P1–P32，且正例做真实语义断言', () => {
    const manifest = read('tests/fixtures/target-schema-assertions.md');
    const known = new Set(
      [...manifest.matchAll(/^\|\s*(P\d+)\s*\|/gm)].map((m) => m[1])
    );
    const fixture = read('tests/fixtures/target-schema-positive.sql');
    const cases = [...fixture.matchAll(/^--\s*@case\s+(P\d+)/gm)].map(
      (m) => m[1]
    );
    for (const id of known) {
      expect(cases, `附录 B.1 的 ${id} 没有可执行夹具`).toContain(id);
    }
    assertFixtureShape(fixture);

    // 正例不是「只检查没报错」：断言写在 DO 块里，失败会 RAISE P0001。
    expect((fixture.match(/\bdo \$\$/g) ?? []).length).toBeGreaterThanOrEqual(
      20
    );
    // T40 硬前置：P21 / P22 必须显式 SKIP，附录里的旧性能数字不得写进夹具。
    const skipped = [
      ...fixture.matchAll(/^--\s*@case\s+(P\d+)\s*\n--\s*@expect\s+SKIP/gm),
    ].map((m) => m[1]);
    expect(skipped).toEqual(expect.arrayContaining(['P21', 'P22']));
    expect(fixture).not.toMatch(/26\.454|42\.930/);
  });

  test('D-9 T38：脚本同时消费正反例两份夹具，并支持三种 @expect', () => {
    const script = read('scripts/verify-target-schema.mjs');
    expect(script).toContain('tests/fixtures/target-schema-negative.sql');
    expect(script).toContain('tests/fixtures/target-schema-positive.sql');
    expect(script).toContain("item.expect === 'SKIP'");
    expect(script).toContain("item.expect === 'OK'");
    expect(script).toContain('/^\\d{5}$/');
    expect(script).toContain('--parity');
    expect(script).toContain('verifyParity');
  });

  test('D-10 T39 后半：parity 排除 auth.* 且 TS 已追平两处基线列漂移', () => {
    const script = read('scripts/verify-target-schema.mjs');
    expect(script).toMatch(/key\.startsWith\('public\.'\)/);
    expect(script).toContain('information_schema.columns');
    expect(script).toContain("contype = 'p'");
    expect(script).toContain("contype = 'f'");
    expect(script).toContain('T39 parity 逐表结构');

    const schema = read('lib/db/schema/project.ts');
    expect(schema).toMatch(/description:\s*text\('description'\)/);
    expect(schema).toMatch(/seq:\s*integer\('seq'\)/);
    const snapshot = JSON.parse(
      read('lib/db/migrations/meta/0000_snapshot.json')
    );
    expect(Object.keys(snapshot.tables['public.project'].columns)).toContain(
      'description'
    );
    expect(Object.keys(snapshot.tables['public.folder'].columns)).toContain(
      'seq'
    );
  });
});
