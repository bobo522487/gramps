/**
 * F6 (single file ≤ 400 lines) as a checkable rule. The pure function lives
 * here so tests can exercise the rule without walking the repository; the CLI
 * wrapper in scripts/check-file-size.mjs does the walking.
 */

export const F6_LIMIT = 400;

/**
 * Returns one entry per problem. A violation is either a file over the limit
 * that is not exempted, or an exemption whose file is already under it —
 * stale exemptions are reported so the allowlist shrinks instead of rotting.
 *
 * @param {{ path: string, lines: number }[]} files
 * @param {string[]} exempt
 * @returns {{ path: string, lines: number, reason: 'over-limit' | 'stale-exemption' }[]}
 */
export function fileSizeViolations(files, exempt) {
  const exemptSet = new Set(exempt);
  const seen = new Set();
  /** @type {{ path: string, lines: number, reason: 'over-limit' | 'stale-exemption' }[]} */
  const violations = [];

  for (const file of files) {
    const isOver = file.lines > F6_LIMIT;
    const isExempt = exemptSet.has(file.path);

    if (isOver && !isExempt) {
      violations.push({
        path: file.path,
        lines: file.lines,
        reason: 'over-limit',
      });
    } else if (!isOver && isExempt) {
      violations.push({
        path: file.path,
        lines: file.lines,
        reason: 'stale-exemption',
      });
    }
    if (isExempt) {
      seen.add(file.path);
    }
  }

  for (const path of exemptSet) {
    if (!seen.has(path)) {
      violations.push({ path, lines: 0, reason: 'stale-exemption' });
    }
  }

  return violations;
}
