#!/usr/bin/env node

// 文档集门禁（按当前文档结构）。
// 旧结构规则（architecture/ 00–13 连续编号、decisions/ 待决策表、guides/、
// docs/ 根级仅 README、旧实现措辞黑名单）随旧文档体系下线一并退役。
// 违禁短语不在本文件留一份过期保护：待 P0-1 统一权威口径后按目标态重定。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const STRICT = process.argv.includes('--strict');
const issues = [];

function walk(dir) {
  if (!existsSync(dir)) return [];
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
    for (const match of readFileSync(file, 'utf8').matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
      slugs.add(slugify(match[1]));
    }
    headingCache.set(file, slugs);
  }
  return headingCache.get(file);
}

const allDocs = walk(DOCS);

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
      addIssue(file, lineOf(content, match.index), 'link', `missing link target: ${target}`);
      continue;
    }
    if (anchor && resolved.endsWith('.md') && !headingsOf(resolved).has(anchor)) {
      addIssue(file, lineOf(content, match.index), 'link', `missing anchor: ${target}`);
    }
  }
}

// 2. 每份文档头部四项（CONTRIBUTING.md §3）。
const HEADER_FIELDS = ['回答什么问题', '读者', '长度上限', '不写什么'];
for (const file of allDocs) {
  const header = readFileSync(file, 'utf8').split('\n').slice(0, 15).join('\n');
  for (const field of HEADER_FIELDS) {
    if (!header.includes(field)) {
      addIssue(file, 1, 'header', `missing header field: ${field}`);
    }
  }
}

// 3. 文档集结构：根级 7 份具名文档 + 3 个子目录各一份 README.md。
const ROOT_DOCS = [
  'vision.md',
  'glossary.md',
  'architecture.md',
  'interfaces.md',
  'data-model.md',
  'nfr.md',
  'roadmap.md',
];
const SUBDIRS = ['adr', 'contracts', 'runbooks'];

for (const name of ROOT_DOCS) {
  if (!existsSync(join(DOCS, name))) {
    addIssue(join(DOCS, name), 1, 'doc-set', `missing root document: docs/${name}`);
  }
}
for (const entry of readdirSync(DOCS)) {
  const full = join(DOCS, entry);
  if (statSync(full).isDirectory()) {
    if (!SUBDIRS.includes(entry)) {
      addIssue(full, 1, 'doc-set', `unexpected docs/ subdirectory: ${entry}`);
    } else if (!existsSync(join(full, 'README.md'))) {
      addIssue(full, 1, 'doc-set', `missing ${entry}/README.md`);
    }
  } else if (extname(entry) === '.md' && !ROOT_DOCS.includes(entry)) {
    addIssue(full, 1, 'doc-set', `unexpected root document: docs/${entry}`);
  }
}

// 4. 已下线的旧文档路径不得被写回，防止有人把删掉的文件当权威引用。
const RETIRED_PATHS = [
  'docs/architecture/',
  'docs/decisions/',
  'docs/guides/',
  'docs/README.md',
  'docs/archive/',
  'docs/superpowers/',
  '00-文档说明.md',
  '11-需求与实现状态.md',
  'AGENTS.md §',
];
for (const file of allDocs) {
  const content = readFileSync(file, 'utf8');
  for (const phrase of RETIRED_PATHS) {
    let index = content.indexOf(phrase);
    while (index !== -1) {
      addIssue(file, lineOf(content, index), 'retired-path', `retired reference: ${phrase}`);
      index = content.indexOf(phrase, index + phrase.length);
    }
  }
}

issues.sort(
  (a, b) =>
    a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule)
);

for (const issue of issues) {
  console.log(`${issue.file}:${issue.line}: [${issue.rule}] ${issue.message}`);
}
console.log(`${issues.length} issue(s)`);

if (STRICT && issues.length > 0) {
  process.exit(1);
}
