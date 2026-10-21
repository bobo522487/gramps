'use server';

import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { validatedActionWithUser } from '@/lib/auth/middleware';
import {
  checkRateLimit,
  getClientIp,
  RATE_LIMIT_ERROR,
} from '@/lib/auth/rate-limit';
import {
  deleteAccountSchema,
  updateAccountSchema,
  updatePasswordSchema,
} from '@/lib/auth/schemas';
import { comparePasswords, hashPassword } from '@/lib/auth/session';
import {
  getUserWithOrg,
  logActivity,
  softDeleteUser,
  updateUserPassword,
  updateUserProfile,
} from '@/lib/db/queries';
import { ActivityType } from '@/lib/db/schema';

export const updatePassword = validatedActionWithUser(
  updatePasswordSchema,
  async (data, _, user) => {
    const { currentPassword, newPassword, confirmPassword } = data;

    const ip = await getClientIp();
    if (
      !checkRateLimit(`update-password:${ip}:${user.id}`, 5, 15 * 60 * 1000)
        .allowed
    ) {
      return { error: RATE_LIMIT_ERROR };
    }

    const isPasswordValid = await comparePasswords(
      currentPassword,
      user.passwordHash
    );

    if (!isPasswordValid) {
      return { error: '当前密码不正确。' };
    }

    if (currentPassword === newPassword) {
      return {
        error: '新密码不能与当前密码相同。',
      };
    }

    if (confirmPassword !== newPassword) {
      return {
        error: '两次输入的新密码不一致。',
      };
    }

    const newPasswordHash = await hashPassword(newPassword);
    const userWithOrg = await getUserWithOrg(user.id);

    await Promise.all([
      updateUserPassword(user.id, newPasswordHash),
      logActivity(userWithOrg?.orgId, user.id, ActivityType.UPDATE_PASSWORD),
    ]);

    return {
      success: '密码已更新。',
    };
  }
);

export const deleteAccount = validatedActionWithUser(
  deleteAccountSchema,
  async (data, _, user) => {
    const { password } = data;

    const ip = await getClientIp();
    if (
      !checkRateLimit(`delete-account:${ip}:${user.id}`, 3, 60 * 60 * 1000)
        .allowed
    ) {
      return { error: RATE_LIMIT_ERROR };
    }

    const isPasswordValid = await comparePasswords(password, user.passwordHash);
    if (!isPasswordValid) {
      return { error: '密码不正确，账号删除失败。' };
    }

    const userWithOrg = await getUserWithOrg(user.id);

    await logActivity(userWithOrg?.orgId, user.id, ActivityType.DELETE_ACCOUNT);

    await softDeleteUser(user.id, userWithOrg?.orgId);

    (await cookies()).delete('session');
    return redirect('/sign-in');
  }
);

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user) => {
    const { name, email } = data;
    const userWithOrg = await getUserWithOrg(user.id);

    await Promise.all([
      updateUserProfile({ userId: user.id, name, email }),
      logActivity(userWithOrg?.orgId, user.id, ActivityType.UPDATE_ACCOUNT),
    ]);

    return { name, success: '账号信息已更新。' };
  }
);
