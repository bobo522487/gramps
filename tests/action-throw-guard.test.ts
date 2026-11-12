import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock('@/lib/auth/context', () => ({
  getSessionUser: mocks.getSessionUser,
}));

import {
  validatedAction,
  validatedActionWithUser,
  validatedActionWithUserObject,
} from '@/lib/auth/middleware';
import type { SessionUser } from '@/lib/auth/types';

const USER: SessionUser = { id: 'u1', name: '张三', email: 'z@example.com' };
const INTERNAL = { code: 'INTERNAL', error: '操作失败，请稍后重试。' };

const schema = z.object({ name: z.string().min(1) });
type Input = z.infer<typeof schema>;

function payload(): FormData {
  const formData = new FormData();
  formData.set('name', '谱序');
  return formData;
}

function nextRedirect(): Error {
  return Object.assign(new Error('NEXT_REDIRECT'), {
    digest: 'NEXT_REDIRECT;307;/dashboard',
  });
}

describe('Action 包装器兜底', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
    mocks.getSessionUser.mockResolvedValue(USER);
  });

  it('validatedActionWithUser 把异常转成 INTERNAL 返回值', async () => {
    const action = validatedActionWithUser(
      schema,
      async (_data: Input, _formData: FormData, _user: SessionUser) => {
        throw new Error('boom');
      }
    );

    await expect(action({}, payload())).resolves.toMatchObject(INTERNAL);
  });

  it('validatedAction 把异常转成 INTERNAL 返回值', async () => {
    const action = validatedAction(
      schema,
      async (_data: Input, _formData: FormData) => {
        throw new Error('boom');
      }
    );

    await expect(action({}, payload())).resolves.toMatchObject(INTERNAL);
  });

  it('validatedActionWithUserObject 把异常转成 INTERNAL 返回值', async () => {
    const action = validatedActionWithUserObject(
      schema,
      async (_data: Input, _user: SessionUser) => {
        throw new Error('boom');
      }
    );

    await expect(action({ name: '谱序' })).resolves.toMatchObject(INTERNAL);
  });

  it('NEXT_* digest 控制流异常在三个通道都原样透传', async () => {
    const withUser = validatedActionWithUser(
      schema,
      async (_data: Input, _formData: FormData, _user: SessionUser) => {
        throw nextRedirect();
      }
    );
    const plain = validatedAction(
      schema,
      async (_data: Input, _formData: FormData) => {
        throw nextRedirect();
      }
    );
    const object = validatedActionWithUserObject(
      schema,
      async (_data: Input, _user: SessionUser) => {
        throw nextRedirect();
      }
    );

    const expected = {
      digest: expect.stringContaining('NEXT_REDIRECT'),
    };
    await expect(withUser({}, payload())).rejects.toMatchObject(expected);
    await expect(plain({}, payload())).rejects.toMatchObject(expected);
    await expect(object({ name: '谱序' })).rejects.toMatchObject(expected);
  });
});
