import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { getSessionUser } from '@/lib/auth/context';
import { mapAuthError } from '@/lib/auth/errors';
import type { SessionUser } from '@/lib/auth/types';
import { actionError } from '@/lib/errors';
import { runWithRequestContext } from '@/lib/server/request-context';

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
    code: 'VALIDATION',
    error: error.issues[0].message,
    fieldErrors: toFieldErrors(error),
    ...(typeof email === 'string' ? { email } : {}),
  };
}

// 每个 Server Action 都从这里进入。用一个 request_id 建立日志上下文，
// 让 action 内部的 addLogContext({ user_id }) 与 logger 输出能落到同一条链路。
// 只生成 id、不读 next/headers：单测直接 await action(...) 时也能跑。
function inRequestContext<T>(action: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ request_id: randomUUID() }, action);
}

// Next.js 用带 NEXT_ digest 的异常实现 redirect/notFound 控制流；它们不是错误，
// 兜底映射会把它们吞成 INTERNAL 返回值，导航就断了。判据只看 digest 前缀。
function isNextControlFlowError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof error.digest === 'string' &&
    error.digest.startsWith('NEXT_')
  );
}

async function guardAction<T>(run: () => Promise<T>): Promise<T | ActionState> {
  try {
    return await run();
  } catch (error) {
    if (isNextControlFlowError(error)) {
      throw error;
    }
    return mapAuthError(error);
  }
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

    return guardAction(() =>
      inRequestContext(() => action(result.data, formData))
    );
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

    return guardAction(() =>
      inRequestContext(() => action(result.data, formData, user))
    );
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
 * 丢掉。写操作仍然是 Server Action（写通道见 `docs/api.md`），只是不走 `<form>` 提交。
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
        code: 'VALIDATION',
        error: result.error.issues[0].message,
        fieldErrors: toFieldErrors(result.error),
      };
    }

    return guardAction(() => inRequestContext(() => action(result.data, user)));
  };
}
