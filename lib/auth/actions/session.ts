'use server';

import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validatedAction } from '@/lib/auth/middleware';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR,
} from '@/lib/auth/rate-limit';
import { signInSchema, signUpSchema } from '@/lib/auth/schemas';
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import {
  acceptInvitation,
  addOrgMember,
  createOrg,
  createUser,
  findPendingInvitation,
  findUserWithOrgByEmail,
  getOrgById,
  getUser,
  getUserWithOrg,
  logActivity,
} from '@/lib/db/queries';
import { ActivityType, type User } from '@/lib/db/schema';

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

  const userWithOrg = await findUserWithOrgByEmail(email);
  if (!userWithOrg) {
    await comparePasswords(password, DUMMY_PASSWORD_HASH);
    return {
      error: '邮箱或密码不正确，请重试。',
      email,
    };
  }

  const { user: foundUser, organization: foundOrg } = userWithOrg;

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
    logActivity(foundOrg?.id, foundUser.id, ActivityType.SIGN_IN),
  ]);

  const redirectTo = formData.get('redirect') as string | null;

  // Only allow same-origin absolute paths to prevent open redirects
  if (redirectTo?.startsWith('/') && !redirectTo.startsWith('//')) {
    redirect(redirectTo);
  }

  return redirect('/dashboard');
});

export const signUp = validatedAction(signUpSchema, async (data, _formData) => {
  const { email, password, inviteId } = data;

  const ip = await getClientIp();
  if (!checkRateLimit(`signup:${ip}`, 5, 60 * 60 * 1000).allowed) {
    return { error: RATE_LIMIT_ERROR, email };
  }

  const existingUser = await findUserWithOrgByEmail(email);
  if (existingUser) {
    return {
      error: '创建账号失败，请重试。',
      email,
    };
  }

  const passwordHash = await hashPassword(password);

  const createdUser = await createUser(email, passwordHash);
  if (!createdUser) {
    return {
      error: '创建账号失败，请重试。',
      email,
    };
  }

  let orgId: number;
  let userRole: string;

  if (inviteId) {
    const invitation = await findPendingInvitation(inviteId);
    if (!invitation || invitation.email !== email) {
      return { error: '邀请无效或已过期。', email };
    }

    orgId = invitation.orgId;
    userRole = invitation.role;

    await acceptInvitation(invitation.id);
    await logActivity(orgId, createdUser.id, ActivityType.ACCEPT_INVITATION);

    const invitedOrg = await getOrgById(orgId);
    if (!invitedOrg) {
      return {
        error: '创建组织失败，请重试。',
        email,
      };
    }
  } else {
    const newOrg = await createOrg(`${email.split('@')[0]} 的组织`);
    if (!newOrg) {
      return {
        error: '创建组织失败，请重试。',
        email,
      };
    }

    orgId = newOrg.id;
    userRole = 'owner';

    await logActivity(orgId, createdUser.id, ActivityType.CREATE_ORG);
  }

  await Promise.all([
    addOrgMember({ userId: createdUser.id, orgId, role: userRole }),
    logActivity(orgId, createdUser.id, ActivityType.SIGN_UP),
    setSession(createdUser),
  ]);

  return redirect('/dashboard');
});

export async function signOut() {
  const user = (await getUser()) as User;
  const userWithOrg = await getUserWithOrg(user.id);
  await logActivity(userWithOrg?.orgId, user.id, ActivityType.SIGN_OUT);
  (await cookies()).delete('session');
}
