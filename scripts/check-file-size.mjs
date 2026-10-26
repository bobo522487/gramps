#!/usr/bin/env node

/**
 * F6: a single file must stay at or below 400 lines, otherwise the file is too
 * large to hold in one head and reviewers stop reading it. Existing debt is
 * listed in EXEMPT with a reason; a stale exemption fails the check so the list
 * shrinks instead of rotting.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileSizeViolations } from './lib/file-size.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SCANNED = ['app', 'components', 'lib', 'hooks'];

const EXEMPT = [
  'lib/lineage/node-services.ts',
  'components/lineage/lineage-detail.tsx',
  'components/lineage/canvas/genealogy-canvas.tsx',
  'components/lineage/lineage-sidebar.tsx',
  'components/ui/sidebar.tsx',
  'lib/db/schema.ts',
  'components/lineage/person-inspector.tsx',
  'components/lineage/node-create-dialog.tsx',
];

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

const files = SCANNED.flatMap((dir) => {
  try {
    return walk(join(ROOT, dir));
  } catch {
    return [];
  }
}).map((full) => ({
  path: relative(ROOT, full).split(sep).join('/'),
  lines: readFileSync(full, 'utf8').split('\n').length - 1,
}));

const violations = fileSizeViolations(files, EXEMPT);

if (violations.length === 0) {
  console.log(
    `[F6] ${files.length} files scanned, ${EXEMPT.length} exemptions, 0 violations`
  );
  process.exit(0);
}

for (const violation of violations) {
  if (violation.reason === 'over-limit') {
    console.error(
      `[F6] ${violation.path}: ${violation.lines} lines exceeds 400 and is not exempt`
    );
  } else {
    console.error(
      `[F6] ${violation.path}: exemption is stale (now ${violation.lines} lines) — remove it from EXEMPT`
    );
  }
}
process.exit(1);
