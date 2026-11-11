import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ADR 0022：运行时只允许一种数据库驱动（node-postgres）。
// 这条守卫取代「文档声明驱动无关」：本地、CI 与 Vercel 必须走同一条代码路径。

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        return sourceFiles(path);
      }
      return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
    }
  );
}

const runtimeSources = sourceFiles('lib').map((path) => ({
  path,
  source: readFileSync(join(root, path), 'utf8'),
}));

describe('数据库驱动单一性', () => {
  it('运行时不再引用 postgres.js', () => {
    const offenders = runtimeSources
      .filter(({ source }) =>
        /from\s+['"](postgres|drizzle-orm\/postgres-js)['"]/.test(source)
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('两个连接入口都用 drizzle-orm/node-postgres', () => {
    for (const path of ['lib/db/drizzle.ts', 'lib/db/auth-db.ts']) {
      const source = readFileSync(join(root, path), 'utf8');
      expect(source).toContain("'drizzle-orm/node-postgres'");
    }
  });

  it('运行时不再读 postgres.js 的 constraint_name 字段', () => {
    const offenders = runtimeSources
      .filter(({ source }) => source.includes('constraint_name'))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('postgres 只作为测试与运维脚本的 devDependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8')
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.postgres).toBeUndefined();
    expect(pkg.devDependencies?.postgres).toBeDefined();
  });
});
