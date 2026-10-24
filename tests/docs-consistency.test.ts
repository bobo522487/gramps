import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function markdownFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    if (entry.startsWith('.backup-') || entry === 'reviews') {
      return [];
    }
    const path = join(dir, entry);
    return statSync(join(root, path)).isDirectory()
      ? markdownFiles(path)
      : path.endsWith('.md')
        ? [path]
        : [];
  });
}

describe('auth documentation', () => {
  test('ADR 0007 records the self-hosted Better Auth decision', () => {
    const adr = read('docs/decisions/0007-self-hosted-better-auth.md');

    expect(adr).toMatch(/Better Auth/);
    expect(adr).toMatch(/^## 决策$/m);
    expect(adr).toMatch(/^## 后果$/m);
    expect(adr).toMatch(/^## 放弃的方案$/m);
    expect(adr).toMatch(/^## 重估触发条件$/m);
  });

  test('the decision index marks ADR-17 as superseded by 0007', () => {
    const index = read('docs/decisions/README.md');
    const row = index.split('\n').find((line) => line.startsWith('| ADR-17 '));

    expect(row).toBeDefined();
    expect(row).toMatch(/0007/);
    expect(row).toMatch(/取代/);
  });

  test('AGENTS.md describes Better Auth as the current authentication', () => {
    const agents = read('AGENTS.md');

    expect(agents).not.toMatch(/bcrypt/i);
    expect(agents).not.toMatch(/\bJWT\b/);
    expect(agents).toMatch(/BETTER_AUTH_SECRET/);
    expect(agents).not.toMatch(/docs\/adr\/0001-foundation-reset\.md/);
  });

  test('setup documents the auth runtime roles and URL', () => {
    const setup = read('docs/setup.md');

    expect(setup).toMatch(/BETTER_AUTH_URL/);
    expect(setup).toMatch(/CREATE ROLE auth_runtime/);
    expect(setup).toMatch(/GRANT auth_service TO auth_runtime/);
  });

  test('no document still asks for AUTH_SECRET', () => {
    const offenders = markdownFiles('docs')
      .filter((path) => /(^|[^_A-Z])AUTH_SECRET\b/.test(read(path)))
      .concat(
        /(^|[^_A-Z])AUTH_SECRET\b/.test(read('AGENTS.md')) ? ['AGENTS.md'] : []
      );

    expect(offenders).toEqual([]);
  });
});
