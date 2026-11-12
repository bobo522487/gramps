import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));

function markdownUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? markdownUnder(full)
      : entry.endsWith('.md')
        ? [relative(root, full)]
        : [];
  });
}

// docs:check 只把文档集与根级治理文档当权威口径。.agents/skills 是宿主提供的
// 通用 spec-kit 套件（PATH_PREFIX 不含 .agents），只核对两个活跃技能的入口，
// 不把技能文档里「IF EXISTS / skip silently」的容错引用当成项目路径依赖。
const PROJECT_DOCS = [
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  ...markdownUnder(join(root, 'docs')),
];

const KEEP = [
  '.specify/memory/constitution.md',
  '.specify/scripts/bash/check-prerequisites.sh',
  '.specify/scripts/bash/common.sh',
  '.specify/.gitignore',
];

describe('speckit 模板减法与最小保留集', () => {
  it('项目文档引用的 .specify 路径都仍有实体', () => {
    const cited = new Set<string>();
    for (const file of PROJECT_DOCS) {
      for (const match of read(file).matchAll(/\.specify\/[\w./-]+/g)) {
        cited.add(match[0]);
      }
    }
    const paths = [...cited].filter((path) => !/NNN|xxx|\$\{/.test(path));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(exists(path), `${path} 被引用但不存在`).toBe(true);
    }
  });

  it('模板层与扩展层已下线，scripts/bash 只剩两个脚本', () => {
    for (const path of [
      '.specify/templates',
      '.specify/extensions',
      '.specify/workflows',
      '.specify/integrations',
      '.specify/memory/.constitution-template.json',
      '.specify/init-options.json',
      '.specify/integration.json',
    ]) {
      expect(exists(path), `${path} 仍在`).toBe(false);
    }
    expect(readdirSync(join(root, '.specify/scripts/bash')).sort()).toEqual([
      'check-prerequisites.sh',
      'common.sh',
    ]);
  });

  it('宪法与最小脚本集仍在，两个活跃技能入口可达', () => {
    for (const path of KEEP) {
      expect(exists(path), `${path} missing`).toBe(true);
    }
    expect(read('.agents/skills/speckit-taskstoissues/SKILL.md')).toContain(
      '.specify/scripts/bash/check-prerequisites.sh'
    );
    expect(read('.agents/skills/speckit-clarify/SKILL.md')).toContain(
      '.specify/memory/constitution.md'
    );
  });

  it('CONTRIBUTING §4 不再指向模板生成 spec', () => {
    const contributing = read('CONTRIBUTING.md');
    expect(contributing).not.toContain('.specify/templates/');
    expect(contributing).not.toContain('specs/NNN-xxx/');
    expect(contributing).toContain('实施计划');
  });
});
