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

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Internal ids are UUIDv7; reject malformed route params before querying. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
