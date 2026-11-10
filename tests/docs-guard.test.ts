import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const GATE = join(root, 'scripts/check-docs.mjs');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function gate(rootDir?: string): { status: number; stdout: string } {
  const args = rootDir
    ? [GATE, '--root', rootDir, '--strict']
    : [GATE, '--strict'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

// fixture 里的坏样本用拼接构造，避免护栏扫到本测试文件自身。
function fixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-guard-'));
  for (const dir of ['docs', 'scripts', 'lib']) {
    mkdirSync(join(tmp, dir), { recursive: true });
  }
  writeFileSync(
    join(tmp, 'scripts/doc-manifest.json'),
    readFileSync(join(root, 'scripts/doc-manifest.json'))
  );
  writeFileSync(join(tmp, 'lib/foo.ts'), 'const a = 1;\nconst b = 2;\n');
  const missing = ['docs', 'nope.md'].join('/');
  const retired = ['docs', 'vision.md'].join('/');
  const header = [
    '> **回答什么问题**：fixture',
    '> **读者**：护栏',
    '> **长度上限**：1 页',
    '> **不写什么**：无',
  ].join('\n');
  writeFileSync(
    join(tmp, 'docs/README.md'),
    ['# 文档入口', '', header, '', '- [探针](probe.md)', ''].join('\n')
  );
  writeFileSync(
    join(tmp, 'docs/probe.md'),
    [
      '# 探针',
      '',
      header,
      '',
      `参考 \`${missing}\`。`,
      `旧路径 ${retired} 已下线。`,
      `[越界行号](../${['lib', 'foo.ts'].join('/')}#L9999)`,
      '',
    ].join('\n')
  );
  return tmp;
}

describe('documentation guard', () => {
  test('single shared manifest exists and both consumers read it', () => {
    const manifestPath = join(root, 'scripts/doc-manifest.json');
    expect(existsSync(manifestPath), 'scripts/doc-manifest.json missing').toBe(
      true
    );
    const manifest = JSON.parse(read('scripts/doc-manifest.json'));
    expect(Array.isArray(manifest.docSet)).toBe(true);
    expect(Array.isArray(manifest.retiredPhrases)).toBe(true);
    expect(read('scripts/check-docs.mjs')).toContain('doc-manifest.json');
    expect(read('tests/docs-consistency.test.ts')).toContain(
      'doc-manifest.json'
    );
  });

  test('gate sees backtick paths, line anchors and retired phrases in a fixture', () => {
    const tmp = fixture();
    try {
      const result = gate(tmp);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('backtick-path');
      expect(result.stdout).toContain('line-anchor');
      expect(result.stdout).toContain('retired-path');
      // Context7: 抛错调用必须包在函数里，不能直接传 execFileSync 的结果。
      expect(() =>
        execFileSync(process.execPath, [GATE, '--root', tmp, '--strict'], {
          stdio: 'pipe',
        })
      ).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('real repo passes the gate', () => {
    const result = gate();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('0 issue(s)');
  });
});
