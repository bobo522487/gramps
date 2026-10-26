import { describe, expect, it } from 'vitest';
import { envAccessViolations } from '@/scripts/lib/env-access.mjs';
import { F6_LIMIT, fileSizeViolations } from '@/scripts/lib/file-size.mjs';

describe('F6 file size check', () => {
  it('flags a file over the limit and passes one at the limit', () => {
    const files = [
      { path: 'app/ok.ts', lines: F6_LIMIT },
      { path: 'app/big.ts', lines: F6_LIMIT + 1 },
    ];

    const violations = fileSizeViolations(files, []);

    expect(violations.map((entry) => entry.path)).toEqual(['app/big.ts']);
  });

  it('honours exemptions, so existing debt does not block the check', () => {
    const files = [{ path: 'app/big.ts', lines: F6_LIMIT + 1 }];

    expect(
      fileSizeViolations(files, [{ path: 'app/big.ts', lines: F6_LIMIT + 1 }])
    ).toEqual([]);
  });

  it('reports an exemption that is no longer needed instead of letting it rot', () => {
    const files = [{ path: 'app/small.ts', lines: 10 }];

    const stale = fileSizeViolations(files, [
      { path: 'app/small.ts', lines: 500 },
    ]);

    expect(stale.map((entry) => entry.path)).toEqual(['app/small.ts']);
    expect(stale[0]?.reason).toBe('stale-exemption');
  });
});

describe('F7 process.env check', () => {
  it('flags process.env outside lib/config.ts', () => {
    const files = [
      { path: 'lib/config.ts', source: 'process.env.DATABASE_URL' },
      { path: 'lib/logger.ts', source: 'process.env.LOG_LEVEL' },
    ];

    expect(envAccessViolations(files).map((entry) => entry.path)).toEqual([
      'lib/logger.ts',
    ]);
  });

  it('allows an explicitly exempted path', () => {
    const files = [{ path: 'lib/db/drizzle.ts', source: 'process.env.VERCEL' }];

    expect(envAccessViolations(files, ['lib/db/drizzle.ts'])).toEqual([]);
  });

  it('catches obfuscated env access forms, not just the literal one', () => {
    const files = [
      { path: 'a.ts', source: "const x = process['env'].FOO;" },
      { path: 'b.ts', source: 'const { env } = process;' },
      { path: 'c.ts', source: 'const x = process . env.FOO;' },
    ];

    const hits = envAccessViolations(files);
    expect(hits.map((entry) => entry.path).sort()).toEqual([
      'a.ts',
      'b.ts',
      'c.ts',
    ]);
  });

  it('does not flag an unrelated identifier that merely contains the text', () => {
    const files = [{ path: 'a.ts', source: 'const processEnvProxy = 1;' }];

    expect(envAccessViolations(files)).toEqual([]);
  });

  it('ratchets: an exempted file may shrink but never grow past its ceiling', () => {
    const budget = [{ path: 'a.ts', lines: 500 }];
    expect(fileSizeViolations([{ path: 'a.ts', lines: 450 }], budget)).toEqual(
      []
    );
    const grew = fileSizeViolations([{ path: 'a.ts', lines: 501 }], budget);
    expect(grew).toHaveLength(1);
    expect(grew[0]?.reason).toBe('over-budget');
  });

  it('lets Next runtime markers through in root entry files only', () => {
    const files = [
      {
        path: 'instrumentation.ts',
        source:
          "if (process.env.NEXT_RUNTIME !== 'nodejs') {}\nconst x = process.env.LOG_LEVEL;",
      },
      { path: 'lib/probe.ts', source: 'process.env.NEXT_RUNTIME' },
    ];

    const hits = envAccessViolations(files);
    // instrumentation.ts:1 is the allowed marker; its line 2 is real config and
    // is still flagged. A marker read outside the root entry is still flagged.
    expect(hits).toEqual([
      { path: 'instrumentation.ts', line: 2 },
      { path: 'lib/probe.ts', line: 1 },
    ]);
  });
});
