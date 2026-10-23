import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { organization } from 'better-auth/plugins/organization';
import { ac, roles } from '@/lib/auth/access-control';
import { getServerConfig } from '@/lib/config';
import { getAuthDb } from '@/lib/db/auth-db';
import { authSchemaMap } from '@/lib/db/auth-schema';

const SEVEN_DAYS_IN_SECONDS = 7 * 24 * 60 * 60;
const ONE_DAY_IN_SECONDS = 24 * 60 * 60;

function createAuth() {
  const config = getServerConfig();

  return betterAuth({
    appName: '云谱',
    baseURL: config.BETTER_AUTH_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.BETTER_AUTH_URL],
    database: drizzleAdapter(getAuthDb(), {
      provider: 'pg',
      schema: authSchemaMap,
      transaction: true,
    }),
    advanced: {
      database: {
        // UUIDv7 defaults live in PostgreSQL; only session tokens are generated here.
        generateId: false,
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 100,
    },
    session: {
      expiresIn: SEVEN_DAYS_IN_SECONDS,
      updateAge: ONE_DAY_IN_SECONDS,
      cookieCache: { enabled: false },
    },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: true },
    },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner',
        invitationExpiresIn: SEVEN_DAYS_IN_SECONDS,
        disableOrganizationDeletion: true,
        requireEmailVerificationOnInvitation: false,
        cancelPendingInvitationsOnReInvite: true,
      }),
      // Must stay last: it writes the session cookie through next/headers.
      nextCookies(),
    ],
  });
}

let instance: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  if (!instance) {
    instance = createAuth();
  }
  return instance;
}

/** Test hook: rebuild the auth instance after changing env or DB clients. */
export function resetAuth() {
  instance = null;
}
