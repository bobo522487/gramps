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
import { dirname, join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const GATE = join(root, 'scripts/check-docs.mjs');

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

function gate(rootDir?: string): { status: number; stdout: string } {
  const args = rootDir ? [GATE, '--root', rootDir] : [GATE];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

// 只放一份缺文档头四项的根级文档；其它违规都排除掉，让断言精确命中 header。
function badHeaderFixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-guard-header-'));
  for (const dir of ['docs', 'scripts']) {
    mkdirSync(join(tmp, dir), { recursive: true });
  }
  writeFileSync(
    join(tmp, 'scripts/doc-manifest.json'),
    readFileSync(join(root, 'scripts/doc-manifest.json'))
  );
  const header = [
    '> **回答什么问题**：fixture',
    '> **读者**：护栏',
    '> **长度上限**：1 页',
    '> **不写什么**：无',
  ].join('\n');
  writeFileSync(
    join(tmp, 'docs/README.md'),
    ['# 文档入口', '', header, '', '- [坏文档](bad.md)', ''].join('\n')
  );
  writeFileSync(join(tmp, 'docs/bad.md'), '# 缺头的文档\n\n正文。\n');
  return tmp;
}

// fixture 里的坏样本用拼接构造，避免护栏扫到本测试文件自身。
function fixture(): string {
  const tmp = mkdtempSync(join(tmpdir(), 'docs-guard-'));
  for (const dir of ['docs', 'scripts', 'lib', '.github/workflows']) {
    mkdirSync(join(tmp, dir), { recursive: true });
  }
  writeFileSync(
    join(tmp, 'scripts/doc-manifest.json'),
    readFileSync(join(root, 'scripts/doc-manifest.json'))
  );
  writeFileSync(join(tmp, 'lib/foo.ts'), 'const a = 1;\nconst b = 2;\n');
  const missing = ['docs', 'nope.md'].join('/');
  const retired = ['docs', 'vision.md'].join('/');
  // 根级治理文档 / 脚本 / workflow 也是坏引用的藏身处，逐处埋一个。
  writeFileSync(join(tmp, 'README.md'), `[坏链](${missing})\n`);
  writeFileSync(
    join(tmp, 'scripts/probe.mjs'),
    `// 旧路径 ${retired} 已下线。\n`
  );
  writeFileSync(
    join(tmp, '.github/workflows/probe.yml'),
    `# 旧路径 ${retired} 已下线。\n`
  );
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
        execFileSync(process.execPath, [GATE, '--root', tmp], {
          stdio: 'pipe',
        })
      ).toThrow();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('gate fails on bad refs without --strict (default is strict)', () => {
    const tmp = fixture();
    try {
      // 默认调用不能再靠 --strict 才失败：本地门禁与 CI 的 no-op 开关都走这条路径。
      const result = spawnSync(process.execPath, [GATE, '--root', tmp], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('backtick-path');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('gate also scans root docs, scripts and workflows', () => {
    const tmp = fixture();
    try {
      const result = gate(tmp);
      expect(result.status).toBe(1);
      // 根级治理文档的坏链接：过去规则 1 只扫 docs/，这里完全漏掉。
      expect(result.stdout).toContain('README.md:1: [link]');
      // 脚本与 workflow 里的退役引用：过去 codeFiles 不含这两个目录。
      expect(result.stdout).toContain('scripts/probe.mjs:1: [retired-path]');
      expect(result.stdout).toContain(
        '.github/workflows/probe.yml:1: [retired-path]'
      );
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

describe('删掉空操作参数与重复原则', () => {
  test('护栏不传 --strict 也会让坏文档失败', () => {
    const tmp = badHeaderFixture();
    try {
      const result = gate(tmp);
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('[header]');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('CI 与护栏不再传空操作参数', () => {
    // 用拼接构造，避免断言里的字面量被护栏当成退役参数扫到本测试自身。
    expect(read('.github/workflows/ci.yml')).not.toContain(
      ['--', 'strict'].join('')
    );
    expect(read('scripts/check-docs.mjs')).not.toContain('保留为 CI 兼容参数');
  });

  test('同一条原则只在 constitution 里写一次', () => {
    const adr = read('docs/adr/README.md');
    expect(adr).not.toContain('写在文档里但拦不住的规则等于没有规则');
    expect(adr).toContain('.specify/memory/constitution.md');
  });
});

describe('content consistency', () => {
  test('环境变量名只有一种写法', () => {
    const model = read('docs/data-model.md');
    expect(model).toContain('AUTH_POSTGRES_URL');
    expect(model).not.toContain('POSTGRES_AUTH_URL');
  });

  test('services.ts 的依赖方向声明有执行者', () => {
    const biome = JSON.parse(read('biome.json'));
    const overrides = biome.overrides as Array<{ includes: string[] }>;
    const override = overrides.find((entry) =>
      entry.includes.some(
        (pattern) => !pattern.startsWith('!') && pattern.includes('services.ts')
      )
    );
    expect(override).toBeDefined();
    const rule = JSON.stringify(override ?? {});
    expect(rule).toContain('next/headers');
    expect(rule).toContain('next/navigation');
    expect(read('docs/architecture.md')).toContain('lib/*/services.ts');
  });

  test('nfr 指向真实存在的「约束要有执行者」章节', () => {
    expect(read('docs/nfr.md')).toContain(
      '`docs/data-model.md` 的「约束要有执行者」'
    );
    expect(read('docs/data-model.md')).toMatch(/^## \d+\. 约束要有执行者/m);
  });

  test('世次公式只有一处真相源', () => {
    const model = read('docs/data-model.md');
    expect(model).toContain('generation = nlevel(path)');
    expect(model).toContain('nlevel(path) + base_generation - 1');
    expect(model).toContain('默认 1');
    for (const file of ['docs/modules/lineage.md', 'docs/overview.md']) {
      const content = read(file);
      expect(content, file).not.toContain('nlevel(path) + base_generation');
      expect(content, file).toContain('docs/data-model.md');
    }
  });

  // 回归锁：Biome 2.x 的 overrides 对同名规则不做 options 合并，
  // 后面匹配同一文件的 override 会整体替换前面的 noRestrictedImports。
  // 曾用探针实测「services 组在前、全局组在后」时规则完全失效（EXIT=0），
  // 因此这里直接把仓库配置复制进临时 git 仓库，逐组验证规则真的会拦。
  test('五组 noRestrictedImports override 都真的会拦', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docs-biome-guard-'));
    try {
      writeFileSync(join(tmp, 'biome.json'), read('biome.json'));
      writeFileSync(join(tmp, '.gitignore'), '');
      execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'ignore' });

      const cases: Array<{ file: string; source: string; message: string }> = [
        {
          file: 'lib/foo/services.ts',
          source:
            "import { redirect } from 'next/navigation';\nexport const value = redirect;\n",
          message: '领域服务不读会话 / 不跳转，由 Action 负责',
        },
        {
          file: 'lib/db/foo/probe.ts',
          source:
            "import { cookies } from 'next/headers';\nexport const value = cookies;\n",
          message: "lib/db 是基础设施层，不得依赖 Next 运行时（F1'）",
        },
        {
          file: 'lib/db/queries/probe.ts',
          source:
            "import { save } from '@/lib/lineage/actions';\nexport const value = save;\n",
          message: '查询层不得依赖 Action 层',
        },
        {
          file: 'components/foo/probe.tsx',
          source: "import 'drizzle-orm';\n",
          message: '客户端组件不得直接依赖 ORM',
        },
        {
          file: 'lib/foo/editor.ts',
          source: "import '@tiptap/core';\n",
          message: '编辑器依赖只允许出现在 lib/article/**',
        },
      ];

      for (const { file, source, message } of cases) {
        const target = join(tmp, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, source);
        const result = spawnSync(
          join(root, 'node_modules/.bin/biome'),
          ['lint', '--config-path', tmp, target],
          { encoding: 'utf8' }
        );
        const output = `${result.stdout}${result.stderr}`;
        expect(result.status, file).toBe(1);
        expect(output, file).toContain('lint/style/noRestrictedImports');
        expect(output, file).toContain(message);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('删掉已腐烂的手抄索引与占位文档', () => {
  test('三份文件不存在、不在 docSet、全仓无残留引用', () => {
    const removed = [
      ['docs', 'directory-structure.md'],
      ['docs', 'code-index.md'],
      ['docs', 'modules', 'book.md'],
    ].map((parts) => parts.join('/'));

    const manifest = JSON.parse(read('scripts/doc-manifest.json')) as {
      docSet: string[];
      retired: string[];
      retiredPhrases: string[];
    };
    for (const path of removed) {
      expect(existsSync(join(root, path)), path).toBe(false);
      expect(manifest.docSet, path).not.toContain(path);
      // 删掉的路径必须登记进退役清单，否则「单一数据源」名不副实。
      expect(manifest.retired, path).toContain(path);
      expect(manifest.retiredPhrases, path).toContain(path);
    }

    const tracked = execFileSync('git', ['ls-files'], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(
        (file) =>
          /\.(md|ts|tsx|mjs|json|yml|yaml)$/.test(file) &&
          // 清单本身必须列出这些路径，跳过它自己；测试文件用拼接构造不在此列。
          file !== 'scripts/doc-manifest.json' &&
          file !== 'tests/docs-guard.test.ts'
      );
    for (const file of tracked) {
      const content = readFileSync(join(root, file), 'utf8');
      for (const path of removed) {
        expect(content, `${file} -> ${path}`).not.toContain(path);
      }
    }
  });
});

// Critical 回归锁：Biome 2.6.3 的 overrides 对同名 noRestrictedImports
// 不合并 options，后匹配组整体替换前匹配组。此前为让 5 组互斥，给全局
// 组加了 `!components/**` 等排除，结果 @tiptap/** 规则在这四类路径静默
// 失活，而「五组都真的会拦」只给每组喂自己的违例，测试全绿却给假保证。
// 这里改成交叉矩阵：每个分区都必须同时拦住「自己的专属禁物」和
// 「全局编辑器依赖」，合法区（编辑器目录、app 的 Server Action）不误伤。
describe('Biome override 交叉覆盖', () => {
  const TIPTAP_MSG = '编辑器依赖只允许出现在 lib/article/**';

  function lint(
    tmp: string,
    file: string,
    source: string
  ): { status: number; output: string } {
    const target = join(tmp, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, source);
    const result = spawnSync(
      join(root, 'node_modules/.bin/biome'),
      ['lint', '--config-path', tmp, target],
      { encoding: 'utf8' }
    );
    return {
      status: result.status ?? 1,
      output: `${result.stdout}${result.stderr}`,
    };
  }

  test('每个分区都拦得住编辑器依赖，且合法区不误伤', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'docs-biome-cross-'));
    try {
      writeFileSync(join(tmp, 'biome.json'), read('biome.json'));
      writeFileSync(join(tmp, '.gitignore'), '');
      execFileSync('git', ['init', '-q'], { cwd: tmp, stdio: 'ignore' });

      const blocked: Array<{ file: string; source: string; message: string }> =
        [
          // 客户端 / hooks：drizzle 专属 + 编辑器依赖
          {
            file: 'components/foo/probe.tsx',
            source: "import 'drizzle-orm';\n",
            message: '客户端组件不得直接依赖 ORM',
          },
          {
            file: 'components/foo/tiptap.tsx',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          {
            file: 'hooks/useFoo.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          {
            file: 'hooks/foo.tsx',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          {
            file: 'hooks/foo.tsx',
            source: "import 'drizzle-orm';\n",
            message: '客户端组件不得直接依赖 ORM',
          },
          // 基础设施层 / 查询层：next/* + actions 专属 + 编辑器依赖
          {
            file: 'lib/db/foo/probe.ts',
            source: "import { cookies } from 'next/headers';\n",
            message: 'lib/db 是基础设施层',
          },
          {
            file: 'lib/db/foo/tiptap.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          {
            file: 'lib/db/queries/probe.ts',
            source: "import { save } from '@/lib/lineage/actions';\n",
            message: '查询层不得依赖 Action 层',
          },
          {
            file: 'lib/db/queries/next.ts',
            source: "import { cookies } from 'next/headers';\n",
            message: 'lib/db 是基础设施层',
          },
          {
            file: 'lib/db/queries/tiptap.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          // 领域服务（含 *-services.ts）：会话/跳转专属 + 编辑器依赖
          {
            file: 'lib/foo/services.ts',
            source: "import { redirect } from 'next/navigation';\n",
            message: '领域服务不读会话 / 不跳转',
          },
          {
            file: 'lib/foo/services.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          {
            file: 'lib/lineage/node-services.ts',
            source: "import { redirect } from 'next/navigation';\n",
            message: '领域服务不读会话 / 不跳转',
          },
          {
            file: 'lib/lineage/node-services.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
          // 全局兜底分区
          {
            file: 'app/foo/tiptap.ts',
            source: "import '@tiptap/core';\n",
            message: TIPTAP_MSG,
          },
        ];

      for (const { file, source, message } of blocked) {
        const { status, output } = lint(tmp, file, source);
        expect(status, `${file} <- ${source.trim()}`).toBe(1);
        expect(output, `${file} <- ${source.trim()}`).toContain(
          'lint/style/noRestrictedImports'
        );
        expect(output, `${file} <- ${source.trim()}`).toContain(message);
      }

      const allowed: Array<{ file: string; source: string }> = [
        // 编辑器依赖的两个合法落点
        {
          file: 'components/article/editor/probe.tsx',
          source: "import '@tiptap/core';\n",
        },
        { file: 'lib/article/probe.ts', source: "import '@tiptap/core';\n" },
        // Server Action 读会话、基础设施层用 ORM 都是正常写法
        {
          file: 'app/foo/action.ts',
          source: "import { cookies } from 'next/headers';\n",
        },
        { file: 'lib/db/foo/ok.ts', source: "import 'drizzle-orm';\n" },
      ];
      for (const { file, source } of allowed) {
        const { status, output } = lint(tmp, file, source);
        expect(status, `${file} <- ${source.trim()}`).toBe(0);
        expect(output, `${file} <- ${source.trim()}`).not.toContain(
          'noRestrictedImports'
        );
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
