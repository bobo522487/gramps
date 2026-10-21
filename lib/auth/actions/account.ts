'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';
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
import { comparePasswords, hashPassword, setSession } from '@/lib/auth/session';
import type { ActionState } from '@/lib/auth/types';
import { isUniqueViolation } from '@/lib/db/errors';
import { logActivity } from '@/lib/db/queries/activity';
import { updateUserPassword, updateUserProfile } from '@/lib/db/queries/users';
import { ActivityType } from '@/lib/db/schema';
import { deleteUserAccount } from '@/lib/db/services';

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
    const tokenVersion = await updateUserPassword(user.id, newPasswordHash);

    // The version bump revokes other devices; re-sign this one so the user
    // who just changed the password is not logged out immediately.
    if (tokenVersion !== null) {
      await setSession({ id: user.id, tokenVersion });
    }

    await logActivity(user.id, null, ActivityType.UPDATE_PASSWORD);

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

    const result = await deleteUserAccount({
      userId: user.id,
      ipAddress: ip === 'unknown' ? undefined : ip,
    });

    if (!result.ok) {
      return {
        error: `你是「${result.orgNames.join(
          '、'
        )}」的唯一所有者，请先转让所有权或归档该组织。`,
      };
    }

    (await cookies()).delete('session');
    return redirect('/sign-in');
  }
);

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user): Promise<ActionState> => {
    const { name, email, currentPassword } = data;
    const emailChanged = email !== user.email.toLowerCase();

    if (emailChanged) {
      const ip = await getClientIp();
      if (
        !checkRateLimit(`update-account:${ip}:${user.id}`, 5, 15 * 60 * 1000)
          .allowed
      ) {
        return { error: RATE_LIMIT_ERROR, name, email };
      }

      if (!currentPassword) {
        return {
          error: '修改邮箱需要输入当前密码。',
          name,
          email,
          fieldErrors: { currentPassword: '请输入当前密码' },
        };
      }

      if (!(await comparePasswords(currentPassword, user.passwordHash))) {
        return {
          error: '当前密码不正确。',
          name,
          email,
          fieldErrors: { currentPassword: '当前密码不正确' },
        };
      }
    }

    try {
      await updateUserProfile({ userId: user.id, name, email });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return {
          error: '该邮箱已被使用。',
          name,
          email,
          fieldErrors: { email: '该邮箱已被使用' },
        };
      }
      throw error;
    }

    await logActivity(user.id, null, ActivityType.UPDATE_ACCOUNT);
    revalidatePath('/dashboard', 'layout');

    return { name, email, success: '账号信息已更新。' };
  }
);
