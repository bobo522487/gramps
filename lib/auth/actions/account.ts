'use server';

import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuth } from '@/lib/auth/better-auth';
import { authErrorMessage } from '@/lib/auth/errors';
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
import type { ActionState } from '@/lib/auth/types';
import { logActivity } from '@/lib/db/queries/activity';
import { getSoleOwnerOrgNames } from '@/lib/db/queries/organizations';
import { ActivityType } from '@/lib/db/schema';
import { revalidateWholeConsole } from '@/lib/lineage/revalidate';
import { logger } from '@/lib/logger';

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

    if (currentPassword === newPassword) {
      return { error: '新密码不能与当前密码相同。' };
    }

    if (confirmPassword !== newPassword) {
      return { error: '两次输入的新密码不一致。' };
    }

    try {
      await getAuth().api.changePassword({
        body: {
          currentPassword,
          newPassword,
          revokeOtherSessions: true,
        },
        headers: await headers(),
      });
    } catch (error) {
      return { error: authErrorMessage(error) };
    }

    try {
      await logActivity(user.id, null, ActivityType.UPDATE_PASSWORD);
    } catch (error) {
      logger.warn('failed to write password activity log', {
        userId: user.id,
        error,
      });
    }

    return { success: '密码已更新。' };
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

    const orgNames = await getSoleOwnerOrgNames(user.id);
    if (orgNames.length > 0) {
      return {
        error: `你是「${orgNames.join(
          '、'
        )}」的唯一所有者，请先转让所有权或归档该组织。`,
      };
    }

    try {
      await logActivity(user.id, null, ActivityType.DELETE_ACCOUNT);
    } catch (error) {
      logger.warn('failed to write delete-account activity log', {
        userId: user.id,
        error,
      });
    }

    try {
      await getAuth().api.deleteUser({
        body: { password },
        headers: await headers(),
      });
    } catch (error) {
      return { error: authErrorMessage(error) };
    }

    return redirect('/sign-in');
  }
);

export const updateAccount = validatedActionWithUser(
  updateAccountSchema,
  async (data, _, user): Promise<ActionState> => {
    try {
      await getAuth().api.updateUser({
        body: { name: data.name },
        headers: await headers(),
      });
    } catch (error) {
      return { error: authErrorMessage(error), name: data.name };
    }

    try {
      await logActivity(user.id, null, ActivityType.UPDATE_ACCOUNT);
    } catch (error) {
      logger.warn('failed to write account activity log', {
        userId: user.id,
        error,
      });
    }
    revalidateWholeConsole();

    return { name: data.name, success: '账号信息已更新。' };
  }
);
