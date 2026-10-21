import type { z } from 'zod';
import { getUser } from '@/lib/db/queries';
import type { User } from '@/lib/db/schema';

export type { ActionState } from './types';

import type { ActionState } from './types';

type ValidatedActionFunction<S extends z.ZodTypeAny, T> = (
  data: z.infer<S>,
  formData: FormData
) => Promise<T>;

function validationState(error: z.ZodError, formData: FormData): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (key && !fieldErrors[key]) {
      fieldErrors[key] = issue.message;
    }
  }
  // Echo the email so React's automatic form reset keeps it on screen
  const email = formData.get('email');
  return {
    error: error.errors[0].message,
    fieldErrors,
    ...(typeof email === 'string' ? { email } : {}),
  };
}

export function validatedAction<S extends z.ZodTypeAny, T>(
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

type ValidatedActionWithUserFunction<S extends z.ZodTypeAny, T> = (
  data: z.infer<S>,
  formData: FormData,
  user: User
) => Promise<T>;

export function validatedActionWithUser<S extends z.ZodTypeAny, T>(
  schema: S,
  action: ValidatedActionWithUserFunction<S, T>
) {
  return async (_prevState: ActionState, formData: FormData) => {
    const user = await getUser();
    if (!user) {
      return { error: '登录已失效，请重新登录。' };
    }

    const result = schema.safeParse(Object.fromEntries(formData));
    if (!result.success) {
      return validationState(result.error, formData);
    }

    return action(result.data, formData, user);
  };
}
