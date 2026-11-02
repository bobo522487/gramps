import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ getSessionUser: vi.fn() }));

vi.mock('@/lib/auth/context', () => ({
  getSessionUser: mocks.getSessionUser,
}));

import {
  validatedActionWithUser,
  validatedActionWithUserObject,
} from '@/lib/auth/middleware';
import type { SessionUser } from '@/lib/auth/types';

const USER = { id: 'u1', name: '张三', email: 'z@example.com' };
const ORG_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ARTICLE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const PAGE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';

const savePageSchema = z.object({
  orgId: z.uuid('组织 ID 无效'),
  articleId: z.uuid('谱文 ID 无效'),
  pageId: z.uuid('页 ID 无效'),
  doc: z.object({
    type: z.literal('doc'),
    content: z.array(z.unknown()),
  }),
  folderId: z.uuid('分类 ID 无效').nullable(),
});

type SavePageInput = z.infer<typeof savePageSchema>;

function savePageSpy() {
  return vi.fn(async (_data: SavePageInput, _user: SessionUser) => ({
    success: '已保存',
  }));
}

describe('validatedActionWithUserObject', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
  });

  it('把嵌套对象与 null 原样交给 action', async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const seen = savePageSpy();
    const action = validatedActionWithUserObject(savePageSchema, seen);

    const result = await action({
      orgId: ORG_ID,
      articleId: ARTICLE_ID,
      pageId: PAGE_ID,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
      folderId: null,
    });

    expect(result).toEqual({ success: '已保存' });
    expect(seen).toHaveBeenCalledTimes(1);
    const [data, user] = seen.mock.calls[0];
    expect(data.folderId).toBeNull();
    expect(data.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(user).toEqual(USER);
  });

  it('未登录时返回中文 ActionState 且不执行 action', async () => {
    mocks.getSessionUser.mockResolvedValue(null);
    const seen = savePageSpy();
    const action = validatedActionWithUserObject(savePageSchema, seen);

    const result = await action({
      orgId: ORG_ID,
      articleId: ARTICLE_ID,
      pageId: PAGE_ID,
      doc: { type: 'doc', content: [] },
      folderId: null,
    });

    expect(seen).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      code: 'UNAUTHORIZED',
      error: '登录已失效，请重新登录。',
    });
  });

  it('校验失败时返回就近字段错误，不回显非法值', async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const seen = savePageSpy();
    const action = validatedActionWithUserObject(savePageSchema, seen);

    const result = await action({
      orgId: 'not-a-uuid',
      articleId: ARTICLE_ID,
      pageId: PAGE_ID,
      doc: { type: 'doc', content: [] },
      folderId: null,
    });

    expect(seen).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      error: '组织 ID 无效',
      fieldErrors: { orgId: '组织 ID 无效' },
    });
  });

  it('载荷不是对象时按校验失败处理', async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const seen = savePageSpy();
    const action = validatedActionWithUserObject(savePageSchema, seen);

    for (const payload of [undefined, null, 'string', 42, []]) {
      const result = await action(payload);
      expect(result).toHaveProperty('error');
    }
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('validatedActionWithUser（FormData 通道不受影响）', () => {
  beforeEach(() => {
    mocks.getSessionUser.mockReset();
  });

  it('仍从 FormData 扁平解析字符串字段', async () => {
    mocks.getSessionUser.mockResolvedValue(USER);
    const flat = z.object({ orgId: z.uuid('组织 ID 无效'), name: z.string() });
    const seen = vi.fn(
      async (
        _data: z.infer<typeof flat>,
        _formData: FormData,
        _user: SessionUser
      ) => ({ success: '已改名' })
    );
    const action = validatedActionWithUser(flat, seen);

    const formData = new FormData();
    formData.set('orgId', ORG_ID);
    formData.set('name', '谱序');

    await action({}, formData);

    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toEqual({ orgId: ORG_ID, name: '谱序' });
  });
});
