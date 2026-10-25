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

  test('data model lists the Better Auth organization columns', () => {
    const model = read('docs/data-model.md');
    const start = model.indexOf('CREATE TABLE organization');
    const table = model.slice(start, model.indexOf(');', start));

    expect(table).toMatch(/\blogo\b/);
    expect(table).toMatch(/\bmetadata\b/);
    expect(table).toMatch(/\bupdated_at\b/);
  });

  test('documented Drizzle version matches package.json', () => {
    const status = read('docs/implementation-status.md');
    const dependency = JSON.parse(read('package.json')).dependencies[
      'drizzle-orm'
    ] as string;
    const minor = dependency
      .replace(/^\D*/, '')
      .split('.')
      .slice(0, 2)
      .join('.');

    expect(status).toContain(`Drizzle ${minor}`);
  });

  test('public ids are documented as text, not varchar', () => {
    expect(read('docs/setup.md')).not.toMatch(/varchar\(20\)/);
  });
});

describe('documented stack versions', () => {
  test('documented stack versions match package.json', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      packageManager: string;
      engines: { node: string };
    };
    const status = read('docs/implementation-status.md');

    expect(pkg.packageManager).toBe('pnpm@12.15.0');
    expect(pkg.engines.node).toBe('>=24.0.0 <25');
    expect(status).toContain(`Next.js ${pkg.dependencies.next}`);
    expect(status).toContain(`React ${pkg.dependencies.react}`);
    expect(status).toContain(`TypeScript ${pkg.devDependencies.typescript}`);
  });

  // package.json is the only source of truth for versions; AGENTS.md and the
  // status doc must not drift from it (ADR 0009 §3: constraints need executors).
  test('AGENTS.md and implementation-status repeat the package.json versions', () => {
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const agents = read('AGENTS.md');
    const status = read('docs/implementation-status.md');

    for (const doc of [agents, status]) {
      expect(doc).toContain(pkg.dependencies.next as string);
      expect(doc).toContain(pkg.dependencies.react as string);
      expect(doc).toContain(pkg.devDependencies.typescript as string);
      expect(doc).toContain(pkg.dependencies['better-auth'] as string);
    }
  });

  test('ADR 0009 records the dependency and runtime stance', () => {
    const adr = read('docs/decisions/0009-dependency-and-runtime-stance.md');
    const index = read('docs/decisions/README.md');

    expect(adr).toMatch(/^## 决策$/m);
    expect(adr).toMatch(/^## 后果$/m);
    expect(adr).toMatch(/^## 放弃的方案$/m);
    expect(adr).toMatch(/^## 重估触发条件$/m);
    expect(index).toContain('0009-dependency-and-runtime-stance.md');
  });
});
