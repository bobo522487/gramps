import { describe, expect, it } from 'vitest';
import { generatePublicId, isPublicId, PUBLIC_ID_LENGTH } from '@/lib/ids';

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
