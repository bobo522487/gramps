import 'server-only';

import { compare, hash } from 'bcryptjs';
import { jwtVerify, SignJWT } from 'jose';
import { cookies } from 'next/headers';
import type { NewUser } from '@/lib/db/schema';

let cachedKey: Uint8Array | null = null;

/** Built on first use so missing AUTH_SECRET doesn't crash import-time. */
function getKey(): Uint8Array {
  if (!cachedKey) {
    if (!process.env.AUTH_SECRET) {
      throw new Error('AUTH_SECRET environment variable is not set');
    }
    cachedKey = new TextEncoder().encode(process.env.AUTH_SECRET);
  }
  return cachedKey;
}

const SALT_ROUNDS = 10;

export async function hashPassword(password: string) {
  return hash(password, SALT_ROUNDS);
}

export async function comparePasswords(
  plainTextPassword: string,
  hashedPassword: string
) {
  return compare(plainTextPassword, hashedPassword);
}

type SessionData = {
  user: { id: number };
  /** Session token version; matched against users.token_version for revocation */
  tv?: number;
  expires: string;
};

export async function signToken(payload: SessionData) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1 day from now')
    .sign(getKey());
}

export async function verifyToken(input: string) {
  const { payload } = await verifySessionToken(input);
  return payload as SessionData;
}

/** Full JWT payload, including `exp` (seconds) for expiry-aware renewal */
export async function verifySessionToken(input: string) {
  return await jwtVerify(input, getKey(), {
    algorithms: ['HS256'],
  });
}

export async function setSession(user: NewUser) {
  const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session: SessionData = {
    user: { id: user.id! },
    tv: user.tokenVersion ?? 0,
    expires: expiresInOneDay.toISOString(),
  };
  const encryptedSession = await signToken(session);
  (await cookies()).set('session', encryptedSession, {
    expires: expiresInOneDay,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
  });
}
