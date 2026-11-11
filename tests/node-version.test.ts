import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const PINNED = '26.13.0';

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

describe('Node.js 运行时版本锚点', () => {
  test('.nvmrc 与 engines.node 都指向 26.13.0', () => {
    expect(read('.nvmrc').trim()).toBe(PINNED);
    const pkg = JSON.parse(read('package.json')) as {
      engines: { node: string; pnpm: string };
    };
    expect(pkg.engines.node).toBe('>=26.0.0 <27');
    expect(pkg.engines.pnpm).toBe('>=12.0.0 <13');
  });

  test('运行时确实是 26.13.0 LTS、ABI 147', () => {
    expect(process.version).toBe(`v${PINNED}`);
    expect(process.versions.modules).toBe('147');
    expect(process.release.lts).toBe('Lithium');
  });

  test('两个 workflow 都从 .nvmrc 继承版本', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/migrate-production.yml',
    ]) {
      const yaml = read(path);
      expect(yaml).toContain('node-version-file: .nvmrc');
      expect(yaml).not.toMatch(/^\s*node-version:/m);
    }
  });
});

test('开发文档与 CHANGELOG 只写 26，不残留 24', () => {
  expect(read('README.md')).toContain('Node.js 26 LTS');

  const dev = read('docs/development.md');
  expect(dev).toContain('`>=26.0.0 <27`');
  expect(dev).toContain('`.nvmrc` 固定 26.13.0');
  expect(dev).toContain('# v26.x');

  expect(read('docs/overview.md')).toContain('26.13.0（`.nvmrc`）');

  for (const path of ['README.md', 'docs/development.md', 'docs/overview.md']) {
    const text = read(path);
    for (const stale of ['24.22.1', '>=24.0.0 <25', 'v24.x', 'Node.js 24 LTS']) {
      expect(text).not.toContain(stale);
    }
  }
});

test('CHANGELOG 的 [未发布] 记录了本次运行时升级', () => {
  const pattern = /## \[未发布\][\s\S]*?Node\.js 26\.13\.0/;
  expect(read('CHANGELOG.md')).toMatch(pattern);
});
