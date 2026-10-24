#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const ARCH_DIR = join(DOCS, 'architecture');
const STRICT = process.argv.includes('--strict');
const issues = [];

function walk(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (extname(name) === '.md') {
      files.push(full);
    }
  }
  return files;
}

const allDocs = walk(DOCS).filter(
  (file) =>
    !file.includes(`${sep}reviews${sep}`) &&
    !file.includes(`${sep}superpowers${sep}`)
);

const contradictionScope = [
  join(DOCS, 'README.md'),
  join(DOCS, 'architect.md'),
  join(DOCS, 'data-model.md'),
  join(DOCS, 'api.md'),
  join(DOCS, 'prd.md'),
  join(DOCS, 'implementation-status.md'),
  ARCH_DIR,
  join(DOCS, 'decisions'),
  join(DOCS, 'guides'),
];

function inScope(file, scope) {
  return scope.some((entry) =>
    entry.endsWith('.md') ? file === entry : file.startsWith(entry + sep)
  );
}

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length;
}

function addIssue(file, line, rule, message) {
  issues.push({
    file: relative(ROOT, file),
    line,
    rule,
    message,
  });
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
    const content = readFileSync(file, 'utf8');
    const slugs = new Set();
    for (const match of content.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      slugs.add(slugify(match[1]));
    }
    headingCache.set(file, slugs);
  }
  return headingCache.get(file);
}

const linkPattern = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

for (const file of allDocs) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1];
    if (/^(https?:|mailto:)/i.test(target) || target.startsWith('#')) {
      continue;
    }
    const [pathPart, anchor] = target.split('#');
    if (!pathPart) {
      continue;
    }
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
    if (anchor && resolved.endsWith('.md')) {
      if (!headingsOf(resolved).has(anchor)) {
        addIssue(
          file,
          lineOf(content, match.index),
          'link',
          `missing anchor: ${target}`
        );
      }
    }
  }
}

const stalePaths = [
  'docs/status/',
  'docs/adr/',
  '── adr/',
  'docs/product/glossary.md',
  'src/modules/',
  'src/server/db',
];

for (const file of allDocs) {
  if (!inScope(file, contradictionScope)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  for (const phrase of stalePaths) {
    let index = content.indexOf(phrase);
    while (index !== -1) {
      addIssue(
        file,
        lineOf(content, index),
        'stale-path',
        `stale reference: ${phrase}`
      );
      index = content.indexOf(phrase, index + phrase.length);
    }
  }
}

const forbiddenPhrases = [
  '没有公开页面',
  'M1 没有匿名访问者',
  '目标收敛为 Server Action',
  '目标 1 个 / 当前 4 个',
  '1 个 Route Handler',
  'M1 唯一的 Route Handler',
  '第 2 个 Route Handler',
  '一次页面渲染只开',
  'revalidateTag',
  'requireOrgContext(data.orgSlug)',
  'ActionResult',
  'lib/error-ui.ts',
  '目标 10 张业务表',
  '10 张业务表 + 4 张',
  '尚未写入本文档正文',
  '≤3 个文件',
  'JWT 自带 exp',
  '全部 10 张业务表都带',
  '/{orgSlug}/{projectRef}',
];

const forbiddenPatterns = [
  {
    rule: 'bare-rls-subquery',
    pattern:
      /organization_id\s+IN\s*\(\s*SELECT[\s\S]*?FROM\s+organization_member/gi,
    label: 'organization_id IN (SELECT ... FROM organization_member)',
  },
];

for (const file of allDocs) {
  if (!inScope(file, contradictionScope)) {
    continue;
  }
  const content = readFileSync(file, 'utf8');
  for (const phrase of forbiddenPhrases) {
    let index = content.indexOf(phrase);
    while (index !== -1) {
      addIssue(
        file,
        lineOf(content, index),
        'contradiction',
        `forbidden phrase: ${phrase}`
      );
      index = content.indexOf(phrase, index + phrase.length);
    }
  }
  for (const { rule, pattern, label } of forbiddenPatterns) {
    for (const match of content.matchAll(pattern)) {
      addIssue(
        file,
        lineOf(content, match.index),
        rule,
        `forbidden pattern: ${label}`
      );
    }
  }
}

for (const file of walk(ARCH_DIR)) {
  const header = readFileSync(file, 'utf8').split('\n').slice(0, 15).join('\n');
  for (const field of ['回答什么问题', '读者', '长度上限']) {
    if (!header.includes(field)) {
      addIssue(file, 1, 'header', `missing header field: ${field}`);
    }
  }
  if (!header.includes('目标 vs 现状') && !header.includes('本文档为新增')) {
    addIssue(file, 1, 'header', 'missing target-vs-current banner');
  }
}

const decisionsFile = join(DOCS, 'decisions', 'README.md');
if (existsSync(decisionsFile)) {
  const lines = readFileSync(decisionsFile, 'utf8').split('\n');
  let inPending = false;
  for (const [index, line] of lines.entries()) {
    if (/^##\s+待决策/.test(line)) {
      inPending = true;
      continue;
    }
    if (inPending && /^##\s+/.test(line)) {
      inPending = false;
      continue;
    }
    if (!inPending) {
      continue;
    }
    const match = line.match(/^\|\s*(D-\d+)\s*\|/);
    if (match && ['D-1', 'D-2', 'D-3', 'D-5', 'D-7'].includes(match[1])) {
      addIssue(
        decisionsFile,
        index + 1,
        'pending',
        `resolved decision still pending: ${match[1]}`
      );
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
  console.log(
    `${issue.file}:${issue.line}: [${issue.rule}] ${issue.message}`
  );
}
console.log(`${issues.length} issue(s)`);

if (STRICT && issues.length > 0) {
  process.exit(1);
}
