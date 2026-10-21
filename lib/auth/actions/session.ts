'use server';

import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/context';
import { validatedAction } from '@/lib/auth/middleware';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR,
} from '@/lib/auth/rate-limit';
import { signInSchema, signUpSchema } from '@/lib/auth/schemas';
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import { logActivity } from '@/lib/db/queries/activity';
import { findUserByEmail } from '@/lib/db/queries/users';
import { ActivityType } from '@/lib/db/schema';
import { registerAccount } from '@/lib/db/services';

// bcrypt of a throwaway value. Unknown emails are compared against it so the
// response time doesn't reveal whether an account exists.
const DUMMY_PASSWORD_HASH =
  '$2b$10$mvwL1NLEj2rHQPE/s4V/h.v6uNKMG1MVbcuhhneJl5LsE29wpHtMq';

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signin:${ip}:${email}`, 10, 15 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  const foundUser = await findUserByEmail(email);
  if (!foundUser) {
    await comparePasswords(password, DUMMY_PASSWORD_HASH);
    return {
      error: '邮箱或密码不正确，请重试。',
      email,
    };
  }

  const isPasswordValid = await comparePasswords(
    password,
    foundUser.passwordHash
  );

  if (!isPasswordValid) {
    return {
      error: '邮箱或密码不正确，请重试。',
      email,
    };
  }

  await Promise.all([
    setSession(foundUser),
    // Account-level event: the user may belong to several organizations.
    logActivity(null, foundUser.id, ActivityType.SIGN_IN),
  ]);

  const redirectTo = formData.get('redirect') as string | null;

  // Only allow same-origin absolute paths to prevent open redirects
  if (redirectTo?.startsWith('/') && !redirectTo.startsWith('//')) {
    redirect(redirectTo);
  }

  return redirect('/dashboard');
});

export const signUp = validatedAction(signUpSchema, async (data) => {
  const { email, password, inviteId } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  const passwordHash = await hashPassword(password);
  const result = await registerAccount({
    email,
    passwordHash,
    inviteId,
    ipAddress: ip === 'unknown' ? '' : ip,
  });

  if (!result.ok) {
    return result.reason === 'invalid_invitation'
      ? { error: '邀请无效或已过期。', email }
      : { error: '创建账号失败，请重试。', email };
  }

  await setSession(result.user);
  return redirect('/dashboard');
});

export async function signOut() {
  const user = await getSessionUser();

  if (user) {
    await logActivity(null, user.id, ActivityType.SIGN_OUT);
  }

  // Always clear the cookie, even when the session was already invalid.
  (await cookies()).delete('session');
}
