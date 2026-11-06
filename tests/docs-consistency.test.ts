import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function markdownFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    if (entry === 'archive') {
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
    const setup = read('docs/architecture/13-本地开发与命令.md');

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
    const model = read('docs/architecture/04-数据视图-数据架构.md');
    const start = model.indexOf('CREATE TABLE organization');
    const table = model.slice(start, model.indexOf(');', start));

    expect(table).toMatch(/\blogo\b/);
    expect(table).toMatch(/\bmetadata\b/);
    expect(table).toMatch(/\bupdated_at\b/);
  });

  test('documented Drizzle version matches package.json', () => {
    const status = read('docs/architecture/11-需求与实现状态.md');
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
    expect(read('docs/architecture/13-本地开发与命令.md')).not.toMatch(
      /varchar\(20\)/
    );
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
    const status = read('docs/architecture/11-需求与实现状态.md');

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
    const status = read('docs/architecture/11-需求与实现状态.md');

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
      'docs/architecture/11-需求与实现状态.md',
      'docs/architecture/13-本地开发与命令.md',
      'docs/architecture/06-部署视图-部署架构.md',
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

/**
 * 「文档收敛为代码可断言的单一真源」：以下断言全部从文件系统 / schema /
 * 源码派生，不手抄计数、不列禁用措辞。文档写错路径或数量时 CI 会拦下，
 * 而不是等下一次架构评审用肉眼发现。
 *
 * 扫描范围＝权威在用文档（AGENTS、constitution、docs/README、architecture、
 * decisions、guides）。archive / specs / superpowers plans / bugs 是按惯例
 * 冻结的历史与在飞产物，不纳入。
 */
const AUTHORITATIVE_DOCS = [
  'AGENTS.md',
  '.specify/memory/constitution.md',
  'docs/README.md',
  ...['docs/architecture', 'docs/decisions', 'docs/guides'].flatMap(
    markdownFiles
  ),
];

// 反引号里的源码 / 文档路径。刻意只认这几个扩展名：这是「别把已删文件写回
// 文档」的窄护栏，不是通用链接检查器（相对链接与锚点由 scripts/check-docs.mjs
// 管）。`docs/` 与 `.specify/` 前缀必须纳入——constitution 的权威文本索引就
// 曾把 11-02 并入前的三份根级文档路径写死在里面（独立评审 I4）。
const CODE_PATH =
  /`((?:app|components|lib|hooks|scripts|tests|data|docs|\.specify)\/[^\s`]+?\.(?:ts|tsx|mjs|js|json|sql|md))`/g;
// `<domain>`、`*`、`{a,b}`、`…` 是占位缩写，不是真实路径。`[projectRef]`
// 这类动态路由目录是**真实目录名**，必须照常校验，不放行。
const PLACEHOLDER = /[<*{…]/;
// 「没有 / 不存在 / 不创建 X」是反面示例，本来就不该存在于仓库里。
// 否定词必须是路径前的最后一段内容（只允许强调符与空白），否则句子里
// 任一个无关的「没有」都能赦免真正写错的引用。
const NEGATION = /(?:没有|不存在|不创建|不要创建|禁止创建)[*\s]*$/;

describe('documentation is checked against code', () => {
  test('authoritative docs do not cite code paths that are absent', () => {
    const offenders: string[] = [];
    for (const path of AUTHORITATIVE_DOCS) {
      const text = read(path);
      for (const match of text.matchAll(CODE_PATH)) {
        if (PLACEHOLDER.test(match[1])) continue;
        if (existsSync(join(root, match[1]))) continue;
        // 否定词必须紧邻这条路径（「没有 `x.ts`」），而不是句子里任一个
        // 无关的「没有」——否则会赦免真正写错的引用。
        const before = text.slice(Math.max(0, match.index! - 12), match.index!);
        if (NEGATION.test(before)) continue;
        offenders.push(`${path}: ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('soft-delete inventory is derived from the schema, never retyped', () => {
    const schemaFiles = readdirSync(join(root, 'lib/db/schema')).filter(
      (file) => file.endsWith('.ts')
    );
    const declared = schemaFiles.reduce(
      (total, file) =>
        total +
        [
          ...read(`lib/db/schema/${file}`).matchAll(
            /deletedAt:\s*timestamptz\('deleted_at'\)/g
          ),
        ].length,
      0
    );

    // Floor, not equality: 新增软删表不该逼人回来改这条断言；ADR 0004 的
    // 「8 张」就是手抄计数失真的下场，现在名单与数量都以 schema 为准。
    expect(declared).toBeGreaterThanOrEqual(14);
    // 活动流是唯一明确不带软删列的组织级表，别让文档把它重新写回去。
    expect(read('lib/db/schema/activity.ts')).not.toContain('deleted_at');
    expect(read('AGENTS.md')).toContain('`activity_logs` 是产品活动流');
  });

  test('the deleted scoped revalidate helpers stay deleted', () => {
    // 只做减法：零调用者 helper 曾在 revalidate.ts 里放了 21 行解释为何没
    // 接线。删掉后不许重新导出，收窄应随 Zod 入参一起实装（ADR 0013 修订）。
    const source = read('lib/console/revalidate.ts');
    expect(source).toContain('export function revalidateWholeConsole()');
    expect(source).not.toMatch(/export function revalidate(?:Project|Org)\b/);
  });

  test('implemented features are not described as placeholders', () => {
    // 01-架构总览 曾把「谱文编辑、谱书编目编辑」合并成一行占位 EmptyState，
    // 而谱文三区编辑器早已落地。以磁盘上的页面文件为事实源断言范围表。
    const articlesPage =
      'app/(dashboard)/dashboard/project/[projectRef]/articles/page.tsx';
    expect(existsSync(join(root, articlesPage))).toBe(true);

    const overview = read('docs/architecture/01-架构总览.md');
    // 分隔符必须存在且唯一；否则 split 返回长度 1、outOfScope='' 会让下面
    // 两条否定断言空转通过（独立评审 I5）。
    const parts = overview.split('**不在这个系统里**');
    expect(parts.length).toBe(2);
    expect(parts[0]).toContain('谱文');
    // 两条否定作用于整篇：即使分隔符被改名，也不会靠空串蒙混过关。
    expect(overview).not.toMatch(/谱文编辑、谱书编目编辑/);
    expect(overview).not.toMatch(/谱文[^|\n]*没有查询函数与 Action/);
  });
});
