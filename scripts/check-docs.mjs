#!/usr/bin/env node

// 文档集门禁（按当前文档结构）。
// 旧结构规则（architecture/ 00–13 连续编号、decisions/ 待决策表、guides/、
// docs/ 根级仅 README、旧实现措辞黑名单）随旧文档体系下线一并退役。
// 退役语义（软删 / 旧角色 / 旧插件）的黑名单在 tests/ 里按目标态重定，见 tests/s8-stage-e.test.ts。
//
// 所有清单（文档集 / 退役路径 / 子目录 / 文档头字段）只有一份真相源：
// scripts/doc-manifest.json。tests/docs-consistency.test.ts 读同一份文件。
// --root <dir> 让 tests/docs-guard.test.ts 能在临时 fixture 上做端到端验证。
// --strict 保留为 CI 兼容参数：护栏现在默认严格，有任何 issue 都失败。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);
const MANIFEST = JSON.parse(
  readFileSync(join(ROOT, 'scripts/doc-manifest.json'), 'utf8')
);
const DOCS = join(ROOT, 'docs');
const issues = [];

function collect(dir, exts) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...collect(full, exts));
    } else if (exts.includes(extname(name))) {
      files.push(full);
    }
  }
  return files;
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function addIssue(file, line, rule, message) {
  issues.push({ file: relative(ROOT, file), line, rule, message });
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const headingCache = new Map();

function headingsOf(file) {
  if (!headingCache.has(file)) {
    const slugs = new Set();
    for (const match of readFileSync(file, 'utf8').matchAll(
      /^#{1,6}\s+(.+?)\s*#*\s*$/gm
    )) {
      slugs.add(slugify(match[1]));
    }
    headingCache.set(file, slugs);
  }
  return headingCache.get(file);
}

const allDocs = collect(DOCS, ['.md']);
const ROOT_MD = [
  'README.md',
  'CONTRIBUTING.md',
  'CHANGELOG.md',
  'AGENTS.md',
  join('.specify', 'memory', 'constitution.md'),
]
  .map((path) => join(ROOT, path))
  .filter((path) => existsSync(path));
const CODE_EXT = ['.ts', '.tsx', '.mjs'];
const codeFiles = ['app', 'components', 'lib', 'hooks', 'tests'].flatMap(
  (dir) => collect(join(ROOT, dir), CODE_EXT)
);
// 链接/锚点/文档头只在 docs/ 内校验（根级治理文档的相对链接基准不同）；
// 退役短语与反引号路径扫到根级文档与代码注释，那里才是坏引用的藏身处。
const scanned = [...allDocs, ...ROOT_MD, ...codeFiles];

// 1. 链接与锚点：与文档结构无关的通用护栏，继续保留。
const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
for (const file of allDocs) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:)/i.test(target) || target.startsWith('#')) continue;
    const [pathPart, anchor] = target.split('#');
    if (!pathPart) continue;
    const resolved = resolve(dirname(file), pathPart);
    if (!existsSync(resolved)) {
      addIssue(
        file,
        lineOf(content, match.index),
        'link',
        `missing link target: ${target}`
      );
      continue;
    }
    if (
      anchor &&
      resolved.endsWith('.md') &&
      !headingsOf(resolved).has(anchor)
    ) {
      addIssue(
        file,
        lineOf(content, match.index),
        'link',
        `missing anchor: ${target}`
      );
    }
    // 行号锚点：#L179 指向 158 行的文件是坏引用，过去完全没人查。
    const lineAnchor = anchor && /^L(\d+)$/.exec(anchor);
    if (lineAnchor && statSync(resolved).isFile()) {
      const total = readFileSync(resolved, 'utf8').split('\n').length;
      if (Number(lineAnchor[1]) > total) {
        addIssue(
          file,
          lineOf(content, match.index),
          'line-anchor',
          `line anchor out of range: ${target} (file has ${total} lines)`
        );
      }
    }
  }
}

// 2. 每份文档头部四项（CONTRIBUTING.md §3）。
// 只约束「文档集」：docs/ 根级文档 + 允许子目录各一份 README。
// 字段清单与子目录清单都来自 scripts/doc-manifest.json，这里不另抄一份。
// ADR 正文有自己的模板（`docs/adr/README.md` §5），feature 工作产物用
// `.specify/templates/`；把它们纳入会误报。
const HEADER_FIELDS = MANIFEST.headerFields;
const SUBDIR_README = new RegExp(
  `^(${MANIFEST.subdirs.join('|')})[/]README\\.md$`
);
for (const file of allDocs) {
  const rel = relative(DOCS, file);
  const isRootDoc = !rel.includes('/') && rel !== 'README.md';
  const isSubdirReadme = SUBDIR_README.test(rel);
  if (!isRootDoc && !isSubdirReadme) continue;
  const header = readFileSync(file, 'utf8').split('\n').slice(0, 15).join('\n');
  for (const field of HEADER_FIELDS) {
    if (!header.includes(field)) {
      addIssue(file, 1, 'header', `missing header field: ${field}`);
    }
  }
}

// 3. 文档集结构：一个 README 入口 + 稳定命名的根级文档 + 允许的子目录。
const SUBDIRS = MANIFEST.subdirs;
const README = join(DOCS, 'README.md');

if (!existsSync(README)) {
  addIssue(README, 1, 'doc-set', 'missing docs/README.md');
} else {
  const readme = readFileSync(README, 'utf8');
  for (const entry of readdirSync(DOCS)) {
    const full = join(DOCS, entry);
    if (statSync(full).isDirectory()) continue;
    if (extname(entry) !== '.md' || entry === 'README.md') continue;
    if (!/^[a-z0-9-]+\.md$/.test(entry)) {
      addIssue(
        full,
        1,
        'doc-set',
        `root document must use kebab-case: ${entry}`
      );
    }
    if (!readme.includes(`](${entry})`)) {
      addIssue(
        full,
        1,
        'doc-set',
        `root document is not linked from README: ${entry}`
      );
    }
  }
}

for (const entry of readdirSync(DOCS)) {
  const full = join(DOCS, entry);
  if (!statSync(full).isDirectory()) continue;
  if (!SUBDIRS.includes(entry)) {
    addIssue(full, 1, 'doc-set', `unexpected docs/ subdirectory: ${entry}`);
    continue;
  }
  if (!existsSync(join(full, 'README.md'))) {
    addIssue(full, 1, 'doc-set', `missing ${entry}/README.md`);
  }
}

const modulesReadme = join(DOCS, 'modules/README.md');
if (existsSync(modulesReadme)) {
  const readme = readFileSync(modulesReadme, 'utf8');
  for (const entry of readdirSync(join(DOCS, 'modules'))) {
    if (extname(entry) !== '.md' || entry === 'README.md') continue;
    if (!readme.includes(`](${entry})`)) {
      addIssue(
        join(DOCS, 'modules', entry),
        1,
        'doc-set',
        `module document is not linked from modules/README.md: ${entry}`
      );
    }
  }
}

// 4. 已下线的旧文档路径不得被写回，防止有人把删掉的文件当权威引用。
// 清单来自 scripts/doc-manifest.json；定义清单的 JSON 不在扫描范围内。
const RETIRED_PATHS = MANIFEST.retiredPhrases;
for (const file of scanned) {
  const content = readFileSync(file, 'utf8');
  for (const phrase of RETIRED_PATHS) {
    let index = content.indexOf(phrase);
    while (index !== -1) {
      addIssue(
        file,
        lineOf(content, index),
        'retired-path',
        `retired reference: ${phrase}`
      );
      index = content.indexOf(phrase, index + phrase.length);
    }
  }
}

// 5. 反引号里的仓库相对路径必须存在。过去只查 Markdown 链接，
// 一次重命名就让 13 处反引号引用失效而门禁全绿。
// 只认带已知扩展名的文件路径：lib/config 这类无扩展名模块名是概念引用，
// NNN / xxx / ${...} 等占位符也不是路径。
const PATH_PREFIX =
  /^(?:docs|lib|app|components|hooks|scripts|tests|\.specify|specs|\.github)\//;
const PATH_EXT = /\.(?:md|ts|tsx|mjs|js|json|sql|yml|yaml|sh)$/;
const SKIP_TOKEN = /[\s<>*]|\$\{|…|\.\.\.|NNN|xxx/i;

function cleanToken(raw) {
  let token = raw.trim();
  if (SKIP_TOKEN.test(token)) return null;
  token = token.replace(/#.*$/, '').replace(/:\d+$/, '').replace(/:$/, '');
  if (token.endsWith('/')) return null;
  if (!PATH_PREFIX.test(token) || !PATH_EXT.test(token)) return null;
  return token;
}

for (const file of scanned) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/`([^`\n]+)`/g)) {
    const raw = match[1].trim();
    if (SKIP_TOKEN.test(raw)) continue;
    const lineRef = /^(.+?):(\d+)$/.exec(raw);
    const cleaned = cleanToken(lineRef ? lineRef[1] : raw);
    if (!cleaned) continue;
    const target = resolve(ROOT, cleaned);
    const line = lineOf(content, match.index);
    if (!existsSync(target)) {
      addIssue(
        file,
        line,
        'backtick-path',
        `missing backtick path: ${cleaned}`
      );
      continue;
    }
    if (lineRef && statSync(target).isFile()) {
      const total = readFileSync(target, 'utf8').split('\n').length;
      if (Number(lineRef[2]) > total) {
        addIssue(
          file,
          line,
          'line-anchor',
          `line reference out of range: ${raw} (file has ${total} lines)`
        );
      }
    }
  }
}

issues.sort(
  (a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.rule.localeCompare(b.rule)
);

for (const issue of issues) {
  console.log(`${issue.file}:${issue.line}: [${issue.rule}] ${issue.message}`);
}
console.log(`${issues.length} issue(s)`);

if (issues.length > 0) {
  process.exit(1);
}
