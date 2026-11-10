import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

// 文档集 / 退役清单 / 权威口径指针只有一份真相源：scripts/doc-manifest.json。
// scripts/check-docs.mjs 读同一份文件，避免两份清单各自漂移。
const MANIFEST = JSON.parse(
  readFileSync(join(root, 'scripts/doc-manifest.json'), 'utf8')
);

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

// 2026-11-08 文档体系整体替换。旧断言（ADR 编号、软删列数、旧架构文档正文、
// 规则正文、实现状态文档）约束的是已下线的旧体系，随旧文档一并退役；
// 护栏改为断言「新文档集齐全 + 旧路径确实移除 + 入口文件只是指针」。
// 执行者是 CI 的 pnpm test:coverage，不是靠评审肉眼守。
describe('document set', () => {
  test('all expected documents and the AGENTS.md entry pointer exist', () => {
    for (const path of [...MANIFEST.docSet, MANIFEST.entry]) {
      expect(existsSync(join(root, path)), `${path} missing`).toBe(true);
    }
  });

  test('retired old documents and archive trees are gone', () => {
    for (const path of MANIFEST.retired) {
      expect(existsSync(join(root, path)), `${path} still present`).toBe(false);
    }
  });

  test('AGENTS.md is an entry pointer, not a second rule source', () => {
    const agents = read(MANIFEST.entry);
    expect(agents).toContain('.specify/memory/constitution.md');
    expect(agents).toContain('CONTRIBUTING.md');
    // 极简入口：规则正文不在这里复制第二份。
    expect(agents.length).toBeLessThan(4000);
  });

  test('docs/ contains exactly the supported directories', () => {
    const dirs = readdirSync(join(root, 'docs'))
      .filter((entry) => statSync(join(root, 'docs', entry)).isDirectory())
      .sort();
    expect(dirs).toEqual([...MANIFEST.subdirs].sort());
  });

  test('constitution keeps I–V numbering so plan.md gates still resolve', () => {
    const constitution = read('.specify/memory/constitution.md');
    for (const numeral of MANIFEST.numerals) {
      expect(constitution).toMatch(new RegExp(`^### ${numeral}\\. `, 'm'));
    }
  });

  test('current documents never cite retired authority paths', () => {
    // 用逐条包含判断而非正则：短语含 § / . / /，转义只会制造读不懂的规则。
    for (const path of [...MANIFEST.docSet, MANIFEST.entry]) {
      const content = read(path);
      for (const phrase of MANIFEST.retiredPhrases) {
        expect(content, `${path}: ${phrase}`).not.toContain(phrase);
      }
    }
  });

  test('retired feature specs do not come back', () => {
    const specs = readdirSync(join(root, 'specs'));
    for (const retired of MANIFEST.retiredFeatureSpecs) {
      expect(specs, retired).not.toContain(retired);
    }
  });

  test('any future plan.md names the constitution, not AGENTS.md', () => {
    for (const entry of readdirSync(join(root, 'specs'))) {
      if (!statSync(join(root, 'specs', entry)).isDirectory()) continue;
      const plan = join('specs', entry, 'plan.md');
      if (!existsSync(join(root, plan))) continue;
      expect(read(plan), plan).not.toMatch(/原则正文见 `AGENTS\.md`/);
    }
  });

  test('code comments do not cite sections of retired specs', () => {
    // 拆开拼接，避免本文件里的字面串被自己的断言命中。
    const legacy = new RegExp(
      ['AGENTS', 'research', 'contracts', 'data-model']
        .map((s) => `${s} §`)
        .join('|')
    );
    const collect = (dir: string): string[] => {
      if (!existsSync(dir)) return [];
      return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return collect(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
      });
    };
    for (const dir of ['app', 'components', 'lib', 'hooks', 'tests']) {
      for (const file of collect(join(root, dir))) {
        expect(readFileSync(file, 'utf8'), file).not.toMatch(legacy);
      }
    }
  });

  test('authority rule is stated once and pointed to from current-state docs', () => {
    expect(read(MANIFEST.authority.file)).toContain(MANIFEST.authority.needle);
    for (const path of MANIFEST.authority.docs) {
      expect(read(path), path).toContain(MANIFEST.authority.pointer);
    }
  });
});
