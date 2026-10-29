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

// Ratchet budget: each entry is the line count when it was exempted. Growing
// past the ceiling fails the check; only shrinking (toward eventually removing
// the exemption) is allowed. Captured at feat/arch-simplification.
const EXEMPT = [
  { path: 'lib/lineage/node-services.ts', lines: 875 },
  { path: 'components/lineage/lineage-detail.tsx', lines: 865 },
  { path: 'components/lineage/canvas/genealogy-canvas.tsx', lines: 776 },
  { path: 'components/lineage/lineage-sidebar.tsx', lines: 734 },
  { path: 'components/ui/sidebar.tsx', lines: 717 },
  { path: 'components/lineage/person-inspector.tsx', lines: 606 },
  { path: 'components/lineage/node-create-dialog.tsx', lines: 583 },
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
  lines: (readFileSync(full, 'utf8').match(/\n/g) ?? []).length,
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
  } else if (violation.reason === 'over-budget') {
    console.error(
      `[F6] ${violation.path}: ${violation.lines} lines exceeds its exemption ceiling — shrink the file or justify a raised ceiling in review`
    );
  } else {
    console.error(
      `[F6] ${violation.path}: exemption is stale (now ${violation.lines} lines) — remove it from EXEMPT`
    );
  }
}
process.exit(1);
