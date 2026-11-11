import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  createRootNodeInTransaction: vi.fn(),
  addChildInTransaction: vi.fn(),
  addSiblingInTransaction: vi.fn(),
  addSpouseInTransaction: vi.fn(),
  deleteNodeInTransaction: vi.fn(),
  moveNodeInTransaction: vi.fn(),
  updateNodeInTransaction: vi.fn(),
  toNodeDetails: vi.fn(() => ({})),
  revalidateWholeConsole: vi.fn(),
}));

vi.mock('@/lib/auth/context', () => ({
  getSessionUser: mocks.getSessionUser,
}));

vi.mock('@/lib/lineage/node-services', () => ({
  createRootNodeInTransaction: mocks.createRootNodeInTransaction,
  addChildInTransaction: mocks.addChildInTransaction,
  addSiblingInTransaction: mocks.addSiblingInTransaction,
  addSpouseInTransaction: mocks.addSpouseInTransaction,
  deleteNodeInTransaction: mocks.deleteNodeInTransaction,
  moveNodeInTransaction: mocks.moveNodeInTransaction,
  updateNodeInTransaction: mocks.updateNodeInTransaction,
  toNodeDetails: mocks.toNodeDetails,
}));

vi.mock('@/lib/lineage/services', () => ({
  createLineageInTransaction: vi.fn(),
  deleteLineageInTransaction: vi.fn(),
  updateLineageInTransaction: vi.fn(),
}));

vi.mock('@/lib/console/revalidate', () => ({
  revalidateWholeConsole: mocks.revalidateWholeConsole,
}));

import type { ActionState } from '@/lib/auth/types';
import {
  addChildAction,
  addPersonAction,
  addSiblingAction,
  createRootNodeAction,
} from '@/lib/lineage/actions';

const USER = { id: 'u1', name: '张三', email: 'z@example.com' };
const ORG_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const LINEAGE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const NODE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d';

const WRITE_FNS = [
  mocks.createRootNodeInTransaction,
  mocks.addChildInTransaction,
  mocks.addSiblingInTransaction,
  mocks.addSpouseInTransaction,
  mocks.deleteNodeInTransaction,
  mocks.moveNodeInTransaction,
  mocks.updateNodeInTransaction,
];

// 四个 node Action 都由 validatedActionWithUser 包装：先 await getSessionUser，
// 再 schema.safeParse(Object.fromEntries(formData))。守卫在 action 回调里、这两
// 步之后，所以入参必须能让两步都过，否则 Zod 会先拦下、守卫根本到不了。
function payload(extra: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('orgId', ORG_ID);
  fd.set('lineageId', LINEAGE_ID);
  fd.set('name', '张三');
  fd.set('sex', 'male');
  fd.set('spouseName', '李四');
  fd.set('spouseSurname', '李');
  for (const [key, value] of Object.entries(extra)) {
    fd.set(key, value);
  }
  return fd;
}

function expectNoWrite() {
  for (const fn of WRITE_FNS) {
    expect(fn).not.toHaveBeenCalled();
  }
}

type Wrapped = (prevState: ActionState, formData: FormData) => Promise<unknown>;

const cases: Array<[string, Wrapped, Record<string, string>]> = [
  ['createRootNodeAction', createRootNodeAction, {}],
  ['addChildAction', addChildAction, { parentId: NODE_ID }],
  ['addSiblingAction', addSiblingAction, { siblingOfId: NODE_ID }],
  ['addPersonAction', addPersonAction, {}],
];

describe('配偶入参边界拒绝', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionUser.mockResolvedValue(USER);
    mocks.toNodeDetails.mockReturnValue({});
    for (const fn of WRITE_FNS) {
      fn.mockResolvedValue({ ok: true, node: { id: 'n1' } });
    }
  });

  it.each(cases)(
    '%s 带配偶入参时返回 not_supported 且不调 service',
    async (_name, action, extra) => {
      const result = await action({}, payload(extra));
      expect(result).toEqual({ error: '当前版本暂不支持该操作' });
      expectNoWrite();
    }
  );
});
