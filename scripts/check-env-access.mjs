#!/usr/bin/env node

/**
 * F7: 应用代码（app/components/lib/hooks）不在 lib/config.ts 之外读
 * process.env，缺配或拼错的配置在启动时就报错，而不是在请求中途变成 undefined。
 * scripts/** 与根级 *.config.ts 是已声明的直接读取方，逐项列在 EXEMPT；这些
 * 是迁移/校验/门禁脚本，不走 Next 运行时，配置校验由它们自己做。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envAccessViolations } from './lib/env-access.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SCANNED = ['app', 'components', 'lib', 'hooks', 'scripts'];
// Root entry files are platform bootstrap; the checker allows only the exact
// NEXT_RUNTIME/NEXT_PHASE markers in instrumentation.ts (see scripts/lib/env-access.mjs).
// Root config files are added to the scan too; they are declared readers in EXEMPT.
const ROOT_FILES = [
  'instrumentation.ts',
  'proxy.ts',
  'drizzle.config.ts',
  'playwright.config.ts',
];

// 应用目录（app/components/lib/hooks）零豁免：lib/config.ts 是唯一读取方。
// scripts/** 与根级 *.config.ts 是已声明的 env 直接读取方，逐项列出，靠
// doc-manifest/nfr 的登记与评审维持，不用「零豁免」掩盖它们一直存在的读取。
// envAccessViolations 按整文件跳过，新增脚本若读 env 必须在此登记（或改走
// lib/config.ts），不得悄悄扩大扫描范围而不登记。
const EXEMPT = [
  'drizzle.config.ts',
  'playwright.config.ts',
  'scripts/check-env-access.mjs',
  'scripts/diagnose-drizzle-state.mjs',
  'scripts/diagnose-migration.mjs',
  'scripts/lib/env-access.mjs',
  'scripts/provision-roles.mjs',
  'scripts/reset-target-db.mjs',
  'scripts/verify-deployment.mjs',
  'scripts/verify-target-schema.mjs',
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (
      name.endsWith('.ts') ||
      name.endsWith('.tsx') ||
      name.endsWith('.mjs')
    ) {
      out.push(full);
    }
  }
  return out;
}

const scanned = [
  ...SCANNED.flatMap((dir) => {
    try {
      return walk(join(ROOT, dir));
    } catch {
      return [];
    }
  }),
  ...ROOT_FILES.filter((name) => existsSync(join(ROOT, name))).map((name) =>
    join(ROOT, name)
  ),
];
const files = scanned.map((full) => ({
  path: relative(ROOT, full).split(sep).join('/'),
  source: readFileSync(full, 'utf8'),
}));

const violations = envAccessViolations(files, EXEMPT);

if (violations.length === 0) {
  console.log(`[F7] ${files.length} files scanned, 0 process.env violations`);
  process.exit(0);
}

for (const violation of violations) {
  console.error(
    `[F7] ${violation.path}:${violation.line}: reads process.env outside lib/config.ts`
  );
}
process.exit(1);
