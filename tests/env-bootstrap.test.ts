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

// A module specifier for dotenv: a quote, `dotenv`, an optional subpath, then
// the *same* quote. That single shape covers every form that actually loads the
// package — `import 'dotenv'`, `'dotenv/config'`, the subpath `'dotenv/lib/main'`
// (the old `(\/config)?` group missed it), `require('dotenv')`, and
// `await import('dotenv')` — while bare identifiers like `myDotenvHelper` stay
// clean. A backtick counts as a quote so a tagged/template specifier cannot slip
// past either.
const DOTENV_SPECIFIER = /(['"`])dotenv(?:\/[\w.\-/]+)?\1/;

/**
 * Remove `//` and `/* *\/` comments so prose about dotenv cannot trip the guard.
 * Small state machine instead of a regex: it tracks string and template-literal
 * state so a `//` inside `'https://…'` is not treated as a comment, and it does
 * not touch string contents — an import specifier is itself a string.
 * Template interpolation (`${…}`) is not parsed; a dotenv specifier built at
 * runtime is out of reach of any static guard and belongs in review.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        state = ch === "'" ? 'single' : ch === '"' ? 'double' : 'template';
      }
      out += ch;
      i += 1;
      continue;
    }

    if (state === 'line') {
      if (ch === '\n') {
        state = 'code';
        out += ch;
      }
      i += 1;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // Inside a string: keep the contents, honour escapes, end on the quote.
    if (ch === '\\') {
      out += ch + (next ?? '');
      i += 2;
      continue;
    }
    if (ch === "'" && state === 'single') state = 'code';
    if (ch === '"' && state === 'double') state = 'code';
    if (ch === '`' && state === 'template') state = 'code';
    out += ch;
    i += 1;
  }

  return out;
}

function loadsDotenv(source: string): boolean {
  return DOTENV_SPECIFIER.test(stripComments(source));
}

describe('env bootstrap', () => {
  // Loading dotenv is a startup responsibility of entry points, not of modules
  // the bundler pulls into the server build: a module-scope config() there
  // re-runs its side effect on every serverless cold start. The detector below
  // is what enforces that, so its own behaviour is pinned here first — these
  // rows are the falsification of the claim "a subpath trips it, prose does not".
  test('detector matches dotenv module specifiers, not prose', () => {
    // every form that really loads the package must match
    for (const snippet of [
      "import 'dotenv/config';",
      "import dotenvConfig from 'dotenv';",
      "const d = require('dotenv');",
      "await import('dotenv');",
      "import x from 'dotenv/lib/main';",
      'import x from "dotenv/lib/main";',
      'const d = require( `dotenv` );',
    ]) {
      expect(loadsDotenv(snippet), `should match: ${snippet}`).toBe(true);
    }

    // neither prose nor lookalike identifiers may match
    for (const snippet of [
      '// 不加载 dotenv',
      "/* 这里不要用 'dotenv' */",
      '// see https://example.com/dotenv for the design',
      'const myDotenvHelper = 1; // dotenv-ish',
      "export const envFile = '.env';",
    ]) {
      expect(loadsDotenv(snippet), `should not match: ${snippet}`).toBe(false);
    }

    // a `//` inside a string is not a comment: the specifier after it still bites
    expect(
      loadsDotenv(
        "const url = 'https://x/y';\nimport p from 'dotenv/lib/main';"
      )
    ).toBe(true);
  });

  test('lib runtime modules do not load dotenv', () => {
    const files = listTs('lib');

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (RUNTIME_ALLOWLIST.has(file)) {
        continue;
      }
      const src = readFileSync(join(root, file), 'utf8');
      expect(
        loadsDotenv(src),
        `${file} 不应加载 dotenv（非 Next 入口改用 loadEnv）`
      ).toBe(false);
    }
  });
});
