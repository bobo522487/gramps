import { describe, expect, it } from 'vitest';
import {
  generatePublicId,
  isPublicId,
  isUuid,
  PUBLIC_ID_LENGTH,
} from '@/lib/ids';

describe('public ids', () => {
  it('generates 20 lowercase alphanumeric characters', () => {
    const id = generatePublicId();
    expect(id).toHaveLength(PUBLIC_ID_LENGTH);
    expect(id).toMatch(/^[a-z0-9]{20}$/);
  });

  it('generates distinct values', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generatePublicId()));
    expect(ids.size).toBe(200);
  });

  it('accepts only the public id shape', () => {
    expect(isPublicId(generatePublicId())).toBe(true);
    expect(isPublicId('rnxvmzibhipcjpksaluw')).toBe(true);
    expect(isPublicId('RNXVMZIBHIPCJPKSALUW')).toBe(false);
    expect(isPublicId('short')).toBe(false);
    expect(isPublicId('rnxvmzibhipcjpksalu-')).toBe(false);
    expect(isPublicId('rnxvmzibhipcjpksaluw1')).toBe(false);
  });
});

describe('internal ids', () => {
  it('accepts UUID shapes and rejects route junk', () => {
    expect(isUuid('01a15f55-45e5-728e-aaab-23717759124b')).toBe(true);
    expect(isUuid('01A15F55-45E5-728E-AAAB-23717759124B')).toBe(true);
    expect(isUuid('rnxvmzibhipcjpksaluw')).toBe(false);
    expect(isUuid('01a15f55-45e5-728e-aaab')).toBe(false);
    expect(isUuid('01a15f55-45e5-728e-aaab-23717759124g')).toBe(false);
  });
});
