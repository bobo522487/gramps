import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
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
});
