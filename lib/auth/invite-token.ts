import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

/** Raw token goes into the invite URL; the database stores only its hash. */
export function createInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
