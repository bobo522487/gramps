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

    expect(fileSizeViolations(files, ['app/big.ts'])).toEqual([]);
  });

  it('reports an exemption that is no longer needed instead of letting it rot', () => {
    const files = [{ path: 'app/small.ts', lines: 10 }];

    const stale = fileSizeViolations(files, ['app/small.ts']);

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
});
