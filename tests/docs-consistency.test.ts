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

  // D-9 is closed as ADR 0010, but closed as a *decision*, not as an install
  // (ADR 0009 §1: no dependency without a replacement/need). The guard below
  // only bites while the ADR still says 尚未安装, so implementing 谱文 later
  // removes that sentence and the assertion retires with it.
  test('ADR 0010 pins the editor choice without installing it', () => {
    const adr = read('docs/decisions/0010-rich-text-editor-selection.md');
    const index = read('docs/decisions/README.md');

    expect(adr).toMatch(/^## 决策$/m);
    expect(adr).toMatch(/^## 后果$/m);
    expect(adr).toMatch(/^## 放弃的方案$/m);
    expect(adr).toMatch(/^## 重估触发条件$/m);
    expect(index).toContain('0010-rich-text-editor-selection.md');
    expect(adr).toContain('决策 ≠ 现在安装');
    // D-9 must have moved out of the pending table into a resolved entry, and
    // the pending-table executor in scripts/check-docs.mjs must know about it.
    expect(index).not.toMatch(/^\|\s*D-9\s*\|/m);
    expect(index).toMatch(/D-9（富文本选型）→ \[ADR 0010\]/);

    if (adr.includes('尚未安装')) {
      // ADR 0010 bans the editor *packages*, not one dependency field: an
      // `@tiptap/react` added to devDependencies would reach the bundle just
      // the same (and drizzle-kit lives there). The root importer in
      // pnpm-lock.yaml mirrors package.json's two fields, but the lockfile on
      // this branch is stale and a human regenerates it, so assert on
      // package.json instead of failing for an unrelated reason.
      const rootPkg = JSON.parse(read('package.json')) as {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      const deps = [
        ...Object.keys(rootPkg.dependencies),
        ...Object.keys(rootPkg.devDependencies ?? {}),
      ];
      // Semantics: match the *package name* against the rule the ADR states
      // (tiptap / @tiptap/* / prosemirror-* / lexical / slate), not four exact
      // names — otherwise @tiptap/react or prosemirror-model would slip through.
      // `tiptap`-and-friends are matched as a whole name or as a prefix segment
      // (`tiptap-*`) so a hypothetical `my-tiptap-thing` is NOT banned, while
      // `prosemirror-*` is banned by prefix as the ADR says. `lexical` gets the
      // `@lexical/*` scope too; `slate` stays an exact name (`slate-react` is a
      // different package from the editor core we ruled out).
      const banned = (name: string): boolean =>
        name === 'tiptap' ||
        name.startsWith('tiptap-') ||
        name.startsWith('@tiptap/') ||
        name.startsWith('prosemirror-') ||
        name === 'lexical' ||
        name.startsWith('@lexical/') ||
        name === 'slate';
      for (const name of deps) {
        if (banned(name)) {
          throw new Error(
            `依赖 ${name} 违反 ADR 0010「决策 ≠ 现在安装」（tiptap / @tiptap/* / prosemirror-* / lexical / slate）`
          );
        }
      }
    }
  });

  test('deploy verification rejects bare RLS policies on business tables', () => {
    const source = readFileSync('scripts/verify-deployment.mjs', 'utf8');
    // F5 needs a database assertion, not just a docs lint.
    expect(source).toContain('pg_policies');
    expect(source).toContain('has_org_role');
    expect(source).toContain('app_rw policy calls auth.has_org_role');
  });

  test('fitness functions without an executor are deleted, not promised', () => {
    const quality = read('docs/architecture/08-非功能性设计.md');
    const components = read('docs/architecture/03-逻辑视图-模块设计.md');

    // F1/F2 describe a `*.service.ts` / `src/server/db` layout this repo does
    // not have, and F4 was never defined anywhere. A constraint nobody can
    // violate is not a constraint.
    expect(quality).not.toMatch(/F1\/F2\/F4/);
    expect(quality).not.toMatch(/\|\s*F2\s*\|/);
    // Biome noRestrictedImports IS configured (biome.json), so the docs must not
    // keep claiming it is "待接入".
    expect(components).not.toContain('noRestrictedImports 待接入');
    expect(components).not.toContain('Biome `noRestrictedImports` 待接入');
  });

  // D-24 recurred three times because the counts are hand-copied. The journal
  // is the only source of truth for migrations; test counts live in the run.
  test('docs do not hand-copy test or migration counts', () => {
    const forbidden = [
      '18 个 Vitest 文件',
      '18 个文件 137 个用例',
      '11 个文件 117 个用例',
      '12 个文件 134 个用例',
      '七个文件',
      '当前仓库实际是四个迁移',
    ];
    for (const path of [
      'docs/implementation-status.md',
      'docs/setup.md',
      'docs/ops-target.md',
      'docs/README.md',
    ]) {
      const text = read(path);
      for (const claim of forbidden) {
        expect(text, `${path} still claims "${claim}"`).not.toContain(claim);
      }
    }
  });

  test('migration count is derived from the journal, never retyped', () => {
    const journal = JSON.parse(
      read('lib/db/migrations/meta/_journal.json')
    ) as { entries: unknown[] };

    // Floor, not equality: adding a migration must not force editing this test,
    // which would make the test a second hand-copied fact.
    expect(journal.entries.length).toBeGreaterThanOrEqual(11);
  });
});
