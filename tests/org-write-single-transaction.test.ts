import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pgErrorOf } from '@/lib/db/errors';

const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, path), 'utf8');

const source = read('../lib/org/actions.ts');

/** 7 个写 Action 有 3 个不以 Action 结尾，按导出名切段而不是按 xxxAction。 */
function actionBodies(): Map<string, string> {
  const heads = [
    ...source.matchAll(/export const (\w+) = validatedActionWithUser\(/g),
  ];
  const bodies = new Map<string, string>();
  heads.forEach((head, index) => {
    const from = head.index ?? 0;
    const to =
      index + 1 < heads.length
        ? (heads[index + 1].index ?? source.length)
        : source.length;
    bodies.set(head[1], source.slice(from, to));
  });
  return bodies;
}

// inviteOrgMember 的写走 issueInvitation 的普通 INSERT，没有 SECDEF 兜底，
// 保留其应用层授权边界；本任务只收敛其余 6 个单事务 Action。
const SINGLE_TRANSACTION = [
  'createOrgAction',
  'renameOrgAction',
  'deleteOrgAction',
  'acceptInviteAction',
  'removeOrgMember',
  'updateOrgMemberRole',
];

const CONVERGED = [
  'renameOrgAction',
  'deleteOrgAction',
  'removeOrgMember',
  'updateOrgMemberRole',
];

describe('org 写路径单事务结构守卫', () => {
  it('切出全部 7 个写 Action', () => {
    expect([...actionBodies().keys()].sort()).toEqual(
      [...SINGLE_TRANSACTION, 'inviteOrgMember'].sort()
    );
  });

  it('6 个单事务 Action 段各恰好一次 withOrg', () => {
    const bodies = actionBodies();
    for (const name of SINGLE_TRANSACTION) {
      const body = bodies.get(name) ?? '';
      expect((body.match(/withOrg\(/g) ?? []).length, name).toBe(1);
    }
  });

  it('4 个收敛段不再开独立预检事务、不再硬比较角色名', () => {
    const bodies = actionBodies();
    for (const name of CONVERGED) {
      const body = bodies.get(name) ?? '';
      for (const probe of [
        'getOrgById(',
        'checkOrgPermission(',
        'getOrgRole(',
        'findMember(',
        'hasPermission(',
      ]) {
        expect(body, `${name} 仍含 ${probe}`).not.toContain(probe);
      }
      expect(body, name).not.toMatch(/===\s*'(admin|owner)'/);
      expect(body, name).not.toContain('member.role ===');
    }
  });

  it('每个写 Action 仍失效一次，且错误都经统一映射', () => {
    for (const [name, body] of actionBodies()) {
      expect(body, name).toContain('revalidateWholeConsole()');
      expect(body, name).toMatch(
        /mapAuthError\(|mapAcceptInviteError\(|authErrorMessage\(/
      );
    }
  });
});

describe('inviteOrgMember 的授权边界不得随收敛删除', () => {
  it('仍保留 member.invite 权限校验与 admin 邀请 admin 守卫', () => {
    const body = actionBodies().get('inviteOrgMember') ?? '';
    // invite 表 RLS 只做租户隔离，issueInvitation 不是 SECDEF；这三行是唯一
    // 授权边界，删掉即让 viewer 能发邀请、admin 能邀请 admin。
    expect(body).toContain('checkOrgPermission(');
    expect(body).toContain("'member.invite'");
    expect(body).toContain("data.role === 'admin'");
  });
});

function driverFailure(sqlState: string, message: string) {
  const driverError = Object.assign(new Error(message), { code: sqlState });
  return new Error('Failed query', { cause: driverError });
}

describe('删 JS 预检后 SECDEF 中文文案逐字不退化', () => {
  // 逐字对齐 0000_target_schema.sql:880-1010 的 RAISE EXCEPTION 文本。
  const cases: Array<[string, string]> = [
    ['42501', '只有所有者可以修改组织设置'],
    ['42501', '只有所有者或管理员可以移除成员'],
    ['42501', '你没有调整该成员角色的权限'],
    ['42501', '管理员不能管理其他管理员'],
    ['22023', '不能移除自己，请先转让所有权'],
    ['22023', '不能修改所有者的角色'],
    ['22023', '该成员不在此组织中'],
    ['22023', '组织不存在或已归档'],
    ['22023', '不能把成员改成该角色'],
  ];

  for (const [sqlState, message] of cases) {
    it(`${sqlState} ${message} 映射为 DB 原文`, () => {
      expect(pgErrorOf(driverFailure(sqlState, message))).toEqual({
        code: sqlState === '42501' ? 'FORBIDDEN' : 'CONFLICT',
        message,
      });
    });
  }
});
