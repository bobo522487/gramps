'use server';

import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/better-auth';
import { authErrorDetails, authErrorMessage } from '@/lib/auth/errors';
import { validatedAction } from '@/lib/auth/middleware';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR,
} from '@/lib/auth/rate-limit';
import { signInSchema, signUpSchema } from '@/lib/auth/schemas';
import { logger } from '@/lib/logger';

/**
 * 邀请链接里的明文 token（`/join?token=<43 字符>`）。自建 token 之后不再是
 * 插件的 invitation id——那个 id 从没打算当 bearer 凭据用。
 */
function inviteToken(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Only same-origin absolute paths are accepted, never protocol-relative ones. */
function safeRedirectPath(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return null;
  }
  // Browsers normalise a backslash after the leading slash to another slash,
  // so `/\evil.example` would leave the origin just like `//evil.example`.
  const second = value.charAt(1);
  return second === '/' || second === '\\' ? null : value;
}

export const signIn = validatedAction(signInSchema, async (data, formData) => {
  const { email, password } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signin:${ip}:${email}`, 10, 15 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  try {
    await getAuth().api.signInEmail({
      body: { email, password },
      headers: await headers(),
    });
  } catch (error) {
    const message = authErrorMessage(error);
    return {
      error:
        message === '操作失败，请稍后重试。'
          ? '邮箱或密码不正确，请重试。'
          : message,
      email,
    };
  }

  const invite = inviteToken(formData.get('invite'));
  if (invite) {
    redirect(`/dashboard/join?token=${encodeURIComponent(invite)}`);
  }

  const redirectTo = safeRedirectPath(formData.get('redirect'));
  if (redirectTo) {
    redirect(redirectTo);
  }

  return redirect('/dashboard');
});

export const signUp = validatedAction(signUpSchema, async (data) => {
  const { email, password, name, invite } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  try {
    await getAuth().api.signUpEmail({
      body: {
        email,
        password,
        name: name ?? email.split('@')[0],
      },
      headers: await headers(),
    });
  } catch (error) {
    logger.error('sign-up failed', error, authErrorDetails(error));
    return { error: authErrorMessage(error), email };
  }

  if (invite) {
    return redirect(`/dashboard/join?token=${encodeURIComponent(invite)}`);
  }
  return redirect('/dashboard');
});

export async function signOut() {
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch (error) {
    // The cookie may already be gone; sign-out must still land on sign-in.
    logger.warn('failed to revoke Better Auth session', { error });
  }
}
