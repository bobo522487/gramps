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

describe('治理层收敛', () => {
  test('README 只指路，不复制文档地图', () => {
    const readme = read('README.md');
    expect(readme).not.toContain('### 3.1 目录结构');
    expect(readme).not.toContain('| 你要做的事 |');
    expect(readme).toContain('docs/README.md');
  });

  test('术语表只有 docs/glossary.md 一份', () => {
    const overview = read('docs/overview.md');
    expect(overview).not.toContain('## 3. 术语');
    expect(overview).toContain('docs/glossary.md');
    expect(read('docs/README.md')).not.toContain('产品定位、范围、术语');
  });

  test('模块文档标题不带旧 Code Wiki 编号', () => {
    for (const [file, marker] of [
      ['docs/modules/auth-org-project.md', '05 ·'],
      ['docs/modules/lineage.md', '06 ·'],
      ['docs/modules/article-media.md', '07 ·'],
    ] as const) {
      expect(read(file), file).not.toContain(marker);
    }
  });

  test('ADR 索引不再同时声称「不存正文」又引用「正文」', () => {
    const adr = read('docs/adr/README.md');
    expect(adr).toContain('只存索引，不存正文');
    for (const phrase of [
      '正文标注',
      '正文未标',
      '不回改正文',
      '正文不回改',
      '正文保留',
      '修订已在正文',
      'ADR 正文',
      '17 份正文',
      '正文能说',
      '决策正文文件',
    ]) {
      expect(adr, phrase).not.toContain(phrase);
    }
  });

  test('完整映射只有一处，入口不再做假断言', () => {
    expect(read('AGENTS.md')).not.toContain('其余文档只引用编号');
    expect(read('AGENTS.md')).not.toContain('对照表只在');
    expect(read('CONTRIBUTING.md')).not.toContain('§5 与本文 §1');
    expect(read('CONTRIBUTING.md')).toContain('constitution.md');
    expect(read('README.md')).toContain('.specify/memory/constitution.md');
  });

  test('文档头模板说清四个字段', () => {
    const contributing = read('CONTRIBUTING.md');
    expect(contributing).not.toContain('写清三件事');
    expect(contributing).toContain('四个字段');
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
    };
    for (const path of removed) {
      expect(existsSync(join(root, path)), path).toBe(false);
      expect(manifest.docSet, path).not.toContain(path);
    }

    const tracked = execFileSync('git', ['ls-files'], {
      cwd: root,
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter((file) => /\.(md|ts|tsx|mjs|json|yml|yaml)$/.test(file));
    for (const file of tracked) {
      const content = readFileSync(join(root, file), 'utf8');
      for (const path of removed) {
        expect(content, `${file} -> ${path}`).not.toContain(path);
      }
    }
  });
});
