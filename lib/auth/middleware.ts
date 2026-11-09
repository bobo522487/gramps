import type { z } from 'zod';
import { getSessionUser } from '@/lib/auth/context';
import type { SessionUser } from '@/lib/auth/types';
import { actionError } from '@/lib/errors';

export type { ActionState } from './types';

import type { ActionState } from './types';

type ValidatedActionFunction<S extends z.ZodType, T> = (
  data: z.infer<S>,
  formData: FormData
) => Promise<T>;

function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  return fieldErrors;
}

function validationState(error: z.ZodError, formData: FormData): ActionState {
  // Echo the email so React's automatic form reset keeps it on screen
  const email = formData.get('email');
  return {
    error: error.issues[0].message,
    fieldErrors: toFieldErrors(error),
    ...(typeof email === 'string' ? { email } : {}),
  };
}

export function validatedAction<S extends z.ZodType, T>(
  schema: S,
  action: ValidatedActionFunction<S, T>
) {
  return async (_prevState: ActionState, formData: FormData) => {
    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return validationState(result.error, formData);
    }

    return action(result.data, formData);
  };
}

type ValidatedActionWithUserFunction<S extends z.ZodType, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: SessionUser
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodType, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>
) {
  return async (_prevState: ActionState, formData: FormData) => {
    const user = await getSessionUser();
    if (!user) {
      return actionError('UNAUTHORIZED', '登录已失效，请重新登录。');
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return validationState(result.error, formData);
    }

    return action(result.data, formData, user);
  };
}

type ValidatedActionObjectFunction<S extends z.ZodType, T> = (
  data: z.infer<S>,
  user: SessionUser
) => Promise<T>;

/**
 * 对象入参通道：认证与校验链路和 `validatedActionWithUser` 完全一致，只是入参
 * 是客户端传来的对象。谱文的正文是分页文档树、页标识可能为 `null`，而 FormData
 * 通道靠 `Object.fromEntries(formData)` 拍平——嵌套结构与非字符串标量都会在路上
 * 丢掉。写操作仍然是 Server Action（写通道见 `docs/interfaces.md`），只是不走 `<form>` 提交。
 */
export function validatedActionWithUserObject<S extends z.ZodType, T>(
  schema: S,
  action: ValidatedActionObjectFunction<S, T>
) {
  return async (payload: unknown): Promise<T | ActionState> => {
    const user = await getSessionUser();
    if (!user) {
      return actionError('UNAUTHORIZED', '登录已失效，请重新登录。');
    }

    const result = schema.safeParse(payload);
    if (!result.success) {
      return {
        error: result.error.issues[0].message,
        fieldErrors: toFieldErrors(result.error),
      };
    }

    return action(result.data, user);
  };
}
