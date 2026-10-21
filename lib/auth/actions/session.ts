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

  await setSession({ id: foundUser.id, tokenVersion: foundUser.tokenVersion });
  await logActivity(foundUser.id, null, ActivityType.SIGN_IN);

  const inviteToken = formData.get('invite');
  if (typeof inviteToken === 'string' && inviteToken.trim()) {
    redirect(`/dashboard/join?token=${encodeURIComponent(inviteToken.trim())}`);
  }

  const redirectTo = formData.get('redirect') as string | null;

  // Only allow same-origin absolute paths to prevent open redirects
  if (redirectTo?.startsWith('/') && !redirectTo.startsWith('//')) {
    redirect(redirectTo);
  }

  return redirect('/dashboard');
});

export const signUp = validatedAction(signUpSchema, async (data) => {
  const { email, password, invite } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  const passwordHash = await hashPassword(password);
  const result = await registerAccount({
    email,
    name: '',
    passwordHash,
    inviteToken: invite || undefined,
    ipAddress: ip === 'unknown' ? undefined : ip,
  });

  if (!result.ok) {
    if (result.reason === 'invalid_invitation') {
      return { error: '邀请无效或已过期。', email };
    }
    return { error: '该邮箱已被注册，请直接登录。', email };
  }

  await setSession(result.user);
  return redirect('/dashboard');
});

export async function signOut() {
  const user = await getSessionUser();

  if (user) {
    await logActivity(user.id, null, ActivityType.SIGN_OUT);
  }

  // Always clear the cookie, even when the session was already invalid.
  (await cookies()).delete('session');
}
