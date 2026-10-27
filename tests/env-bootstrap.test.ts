import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function listTs(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(join(root, path)).isDirectory()
      ? listTs(path)
      : /\.tsx?$/.test(path)
        ? [path]
        : [];
  });
}

// The invariant boundary is "is this module imported by the Next server
// bundle", not "does it live under lib/". `lib/db/seed.ts` is the one lib file
// that sits on the other side of that line: it is a dev-only CLI entry run by
// `pnpm db:seed` (tsx, outside Next) and nothing under app/ imports it, so it
// must load .env itself — that allowlist entry is live, not dead code.
const RUNTIME_ALLOWLIST = new Set(['lib/db/seed.ts']);

describe('env bootstrap', () => {
  // Loading dotenv is a startup responsibility of entry points, not of modules
  // the bundler pulls into the server build: a module-scope config() there
  // re-runs its side effect on every serverless cold start. The guard matches
  // the module specifier in both forms — `import ... from 'dotenv'` /
  // `import 'dotenv/config'` (quoted specifier) and `require('dotenv')` (quote
  // after the call) — while bare identifiers like `myDotenvHelper` stay clean.
  test('lib runtime modules do not load dotenv', () => {
    const files = listTs('lib');

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (RUNTIME_ALLOWLIST.has(file)) {
        continue;
      }
      const src = readFileSync(join(root, file), 'utf8');
      expect(
        src,
        `${file} 不应加载 dotenv（非 Next 入口改用 loadEnv）`
      ).not.toMatch(/['"]dotenv(\/config)?['"]|require\(\s*['"]dotenv/);
    }
  });
});
