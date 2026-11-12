import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

test('Node 版本护栏只钉 major，不钉 patch / ABI / LTS', () => {
  const src = read('node-version.test.ts');
  expect(src).not.toContain("process.versions.modules).toBe('147')");
  expect(src).not.toContain("process.release.lts).toBe('Lithium')");
  expect(src).not.toContain(['toBe(`v$', '{PINNED}`)'].join(''));
  expect(src).toContain("process.version.startsWith('v26.')");
});

test('护栏不把补丁版本升级变成红灯', () => {
  const major = Number(process.version.slice(1).split('.')[0]);
  expect(major).toBeGreaterThanOrEqual(26);
  expect(major).toBeLessThan(27);
});
