import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

// 2026-11-08 文档体系整体替换。旧断言（ADR 编号、软删列数、旧架构文档正文、
// 规则正文、实现状态文档）约束的是已下线的旧体系，随旧文档一并退役；
// 护栏改为断言「新文档集齐全 + 旧路径确实移除 + 入口文件只是指针」。
// 执行者仍是 CI 的 pnpm test，不是靠评审肉眼守。
const DOC_SET = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  '.specify/memory/constitution.md',
  'docs/vision.md',
  'docs/glossary.md',
  'docs/architecture.md',
  'docs/interfaces.md',
  'docs/data-model.md',
  'docs/nfr.md',
  'docs/roadmap.md',
  'docs/adr/README.md',
  'docs/contracts/README.md',
  'docs/runbooks/README.md',
];
const ENTRY = 'AGENTS.md';

const RETIRED = [
  'docs/README.md',
  'docs/architecture/00-文档说明.md',
  'docs/decisions/README.md',
  'docs/guides/testing.md',
  'docs/archive',
  'docs/superpowers',
  'specs/001-lineage-edit-preview',
  'specs/002-article-authoring',
  'specs/003-article-editor-wordlike',
];

describe('document set', () => {
  test('all 14 new documents and the AGENTS.md entry pointer exist', () => {
    for (const path of [...DOC_SET, ENTRY]) {
      expect(existsSync(join(root, path)), `${path} missing`).toBe(true);
    }
  });

  test('retired old documents and archive trees are gone', () => {
    for (const path of RETIRED) {
      expect(existsSync(join(root, path)), `${path} still present`).toBe(false);
    }
  });

  test('AGENTS.md is an entry pointer, not a second rule source', () => {
    const agents = read(ENTRY);
    expect(agents).toContain('.specify/memory/constitution.md');
    expect(agents).toContain('CONTRIBUTING.md');
    // 极简入口：规则正文不在这里复制第二份。
    expect(agents.length).toBeLessThan(4000);
  });

  test('docs/ contains exactly the three contract directories', () => {
    const dirs = readdirSync(join(root, 'docs'))
      .filter((entry) => statSync(join(root, 'docs', entry)).isDirectory())
      .sort();
    expect(dirs).toEqual(['adr', 'contracts', 'runbooks']);
  });

  test('constitution keeps I–V numbering so plan.md gates still resolve', () => {
    const constitution = read('.specify/memory/constitution.md');
    for (const numeral of ['I', 'II', 'III', 'IV', 'V']) {
      expect(constitution).toMatch(new RegExp(`^### ${numeral}\\. `, 'm'));
    }
  });

  test('new documents never cite retired authority paths', () => {
    const retired =
      /docs\/architecture\/|docs\/decisions\/|docs\/guides\/|docs\/README\.md|docs\/archive\/|docs\/superpowers\/|specs\/00[1-3]-/;
    for (const path of [...DOC_SET, ENTRY]) {
      expect(read(path), path).not.toMatch(retired);
    }
  });

  test('retired feature specs do not come back', () => {
    const specs = readdirSync(join(root, 'specs'));
    for (const retired of [
      '001-lineage-edit-preview',
      '002-article-authoring',
      '003-article-editor-wordlike',
    ]) {
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

  test('authority rule is stated once and pointed to from all four current-state docs', () => {
    expect(read('CONTRIBUTING.md')).toContain('权威口径（目标态例外）');
    for (const path of [
      'docs/architecture.md',
      'docs/interfaces.md',
      'docs/contracts/README.md',
      'docs/nfr.md',
    ]) {
      expect(read(path), path).toContain(
        '裁决顺序见 `CONTRIBUTING.md` §2「权威口径」'
      );
    }
  });
});
