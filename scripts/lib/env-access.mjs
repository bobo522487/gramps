/**
 * F7 (no `process.env` outside lib/config.ts) as a checkable rule. Configuration
 * must be read and validated in exactly one place so a missing variable fails
 * at startup with a clear message instead of producing `undefined` deep in a
 * request path.
 */

export const ENV_OWNER = 'lib/config.ts';

const ENV_PATTERN = /process\.env\b/;

/**
 * @param {{ path: string, source: string }[]} files
 * @param {string[]} exempt
 * @returns {{ path: string, line: number }[]}
 */
export function envAccessViolations(files, exempt = []) {
  const exemptSet = new Set(exempt);
  /** @type {{ path: string, line: number }[]} */
  const violations = [];

  for (const file of files) {
    if (file.path === ENV_OWNER || exemptSet.has(file.path)) {
      continue;
    }
    const lines = file.source.split('\n');
    for (const [index, text] of lines.entries()) {
      if (ENV_PATTERN.test(text)) {
        violations.push({ path: file.path, line: index + 1 });
      }
    }
  }

  return violations;
}
