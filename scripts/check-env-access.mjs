#!/usr/bin/env node

/**
 * F7: `process.env` is read in exactly one file, lib/config.ts, so missing or
 * malformed configuration fails at startup with a clear message instead of
 * turning into `undefined` in the middle of a request.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envAccessViolations } from './lib/env-access.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SCANNED = ['app', 'components', 'lib', 'hooks'];
// Root entry files are platform bootstrap; the checker allows only the exact
// NEXT_RUNTIME/NEXT_PHASE markers in instrumentation.ts (see scripts/lib/env-access.mjs).
const ROOT_FILES = ['instrumentation.ts', 'proxy.ts'];

// Empty on purpose: the goal is zero readers outside lib/config.ts. Adding an
// entry here means accepting a second configuration path; justify it in review.
const EXEMPT = [];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
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
