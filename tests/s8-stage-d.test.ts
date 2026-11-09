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

  test('D-5 T38：反例夹具每条 case 都能回链附录 B.2 场景', () => {
    const manifest = read('tests/fixtures/target-schema-assertions.md');
    const known = new Set(
      [...manifest.matchAll(/^\|\s*(N\d+)\s*\|/gm)].map((m) => m[1])
    );
    const fixture = read('tests/fixtures/target-schema-negative.sql');
    const cases = [...fixture.matchAll(/^--\s*@case\s+(N\d+)/gm)].map(
      (m) => m[1]
    );
    expect(cases.length).toBeGreaterThanOrEqual(15);
    for (const id of cases) {
      expect(known.has(id), `${id} 不在场景清单里`).toBe(true);
    }
    expect([...fixture.matchAll(/^--\s*@expect\s+\d{5}\s*$/gm)]).toHaveLength(
      cases.length
    );
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
});
