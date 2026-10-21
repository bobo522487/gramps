import { randomInt } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export const PUBLIC_ID_LENGTH = 20;
export const PUBLIC_ID_PATTERN = /^[a-z0-9]{20}$/;

/** Public, non-sequential id used in dashboard URLs. */
export function generatePublicId(): string {
  let id = '';
  for (let index = 0; index < PUBLIC_ID_LENGTH; index++) {
    id += ALPHABET[randomInt(ALPHABET.length)];
  }
  return id;
}

export function isPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}
