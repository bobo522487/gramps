import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const colorLiterals =
  /zinc-|emerald-|#181818|#121212|gray-[0-9]|orange-[0-9]|red-[0-9]|green-[0-9]/;

function sourceFiles(dir: string): string[] {
  const root = resolve(import.meta.dirname, dir);
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(`${dir}/${entry}`);
    }
    return /\.(tsx)$/.test(entry) ? [path] : [];
  });
}

describe('design token boundary', () => {
  it('keeps raw color literals out of pages and console composition', () => {
    const offenders: string[] = [];
    for (const dir of [
      '../app/(dashboard)',
      '../app/(login)',
      '../app/(marketing)',
      '../components/console',
      '../components/org',
      '../components/project',
    ]) {
      for (const file of sourceFiles(dir)) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, index) => {
          if (colorLiterals.test(line)) {
            offenders.push(`${file}:${index + 1}`);
          }
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('role mapping', () => {
  it('maps the four organization roles to badges and Chinese labels', async () => {
    const { roleLabel, roleVariant } = await import('@/lib/ui/status');

    expect(roleVariant('owner')).toBe('success');
    expect(roleVariant('admin')).toBe('info');
    expect(roleVariant('editor')).toBe('info');
    expect(roleVariant('viewer')).toBe('secondary');
    // Unknown values stay neutral instead of silently reading as a role
    expect(roleVariant('member')).toBe('outline');

    expect(roleLabel('owner')).toBe('所有者');
    expect(roleLabel('admin')).toBe('管理员');
    expect(roleLabel('editor')).toBe('编辑');
    expect(roleLabel('viewer')).toBe('只读');
    expect(roleLabel('BOGUS')).toBe('BOGUS');
  });
});
