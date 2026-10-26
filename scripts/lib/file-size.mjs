/**
 * F6 (single file ≤ 400 lines) as a checkable rule. The pure function lives
 * here so tests can exercise the rule without walking the repository; the CLI
 * wrapper in scripts/check-file-size.mjs does the walking.
 */

export const F6_LIMIT = 400;

/**
 * Returns one entry per problem:
 * - over-limit: file exceeds 400 lines and is not in the exemption budget
 * - stale-exemption: an exemption whose file is now under the limit (remove it)
 * - over-budget: an exempted file grew past the line count recorded when it was
 *   exempted. The exemption is a ceiling to shrink, not a licence to grow.
 *
 * @param {{ path: string, lines: number }[]} files
 * @param {{ path: string, lines: number }[]} exempt budget entries; bare strings
 *   are accepted for backwards compatibility (treated as no ceiling)
 * @returns {{ path: string, lines: number, reason: 'over-limit' | 'stale-exemption' | 'over-budget' }[]}
 */
export function fileSizeViolations(files, exempt = []) {
  const budget = new Map(
    exempt.map((entry) =>
      typeof entry === 'string'
        ? [entry, { ceiling: Infinity, present: false }]
        : [entry.path, { ceiling: entry.lines, present: true }]
    )
  );
  /** @type {{ path: string, lines: number, reason: 'over-limit' | 'stale-exemption' | 'over-budget' }[]} */
  const violations = [];
  const seen = new Set();

  for (const file of files) {
    const isOver = file.lines > F6_LIMIT;
    const exemption = budget.get(file.path);
    seen.add(file.path);

    if (!exemption) {
      if (isOver) {
        violations.push({
          path: file.path,
          lines: file.lines,
          reason: 'over-limit',
        });
      }
      continue;
    }
    if (!isOver) {
      violations.push({
        path: file.path,
        lines: file.lines,
        reason: 'stale-exemption',
      });
      continue;
    }
    if (exemption.present && file.lines > exemption.ceiling) {
      violations.push({
        path: file.path,
        lines: file.lines,
        reason: 'over-budget',
      });
    }
  }

  for (const path of budget.keys()) {
    if (!seen.has(path)) {
      violations.push({ path, lines: 0, reason: 'stale-exemption' });
    }
  }

  return violations;
}
