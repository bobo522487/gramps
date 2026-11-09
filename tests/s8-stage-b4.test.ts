/**
 * S8 阶段 B · B4：认证层去 Better Auth organization 插件（T28）。
 *
 * 规格唯一真相源是附录 A.1（organization / organization_member / invite）与
 * A.0（auth.user text 主键），落定于 `lib/db/migrations/0000_target_schema.sql`。
 * `organization_member` 的代理主键 `id` 与插件是同一约束的两面（附录 A.1 目标态
 * 是 `(organization_id, user_id)` 主键、无 `id`），本批一并拆除。
 *
 * 拆除后成员模型只剩自有三表；组织上下文早已由边界层查询提供
 * （lib/auth/context.ts 的 getOrgWithRoleBySlug），插件的五个 API 调用点
 * （createOrganization / updateOrganization ×2 / listMembers / removeMember /
 * updateMemberRole）全部改为自有写入路径。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const exists = (path: string) => existsSync(join(root, path));

/** 去掉行注释与块注释，供「不许出现某字符串」这类断言使用。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function tableBlock(source: string, table: string, next?: string) {
  const pattern = new RegExp(`CREATE TABLE ${table} \\(`);
  const match = pattern.exec(source);
  if (!match) throw new Error(`找不到 CREATE TABLE ${table}`);
  const start = match.index;
  const end = next ? source.indexOf(`CREATE TABLE ${next} (`, start) : -1;
  return source.slice(start, end < 0 ? undefined : end);
}

describe('S8 阶段 B · B4 去 organization 插件', () => {
  test('B4-1：better-auth.ts 不再挂插件，access-control 不再依赖 defaultStatements', () => {
    const bootstrap = stripComments(read('lib/auth/better-auth.ts'));
    expect(bootstrap).not.toContain('plugins/organization');
    expect(bootstrap).not.toMatch(/\borganization\(\{/);
    // 自检开关的存废由实现决定，但插件拆除后不允许再把注释里的旧理由当借口：
    // 文件里不许再出现「插件拥有全部表」的自检前提描述。

    const access = stripComments(read('lib/auth/access-control.ts'));
    expect(access).not.toContain('defaultStatements');
    expect(exists('lib/auth/access-control.ts')).toBe(true);
  });

  test('B4-2：T28 验证命令：lib/auth/ 下 plugins/organization 与 defaultStatements 0 命中', () => {
    // 递归扫描（等价于计划里的 grep -rn）。
    const files = ['better-auth.ts', 'access-control.ts', 'context.ts'];
    for (const name of files) {
      const source = stripComments(read(`lib/auth/${name}`));
      expect(source, name).not.toContain('plugins/organization');
      expect(source, name).not.toContain('defaultStatements');
    }
  });

  test('B4-3：organization_member 主键 (organization_id,user_id)，DDL 与 TS 同步去 id', () => {
    const ddl = tableBlock(
      read('lib/db/migrations/0000_target_schema.sql'),
      'organization_member',
      'invite'
    );
    expect(ddl).toContain('PRIMARY KEY (organization_id, user_id)');
    expect(ddl).not.toContain('uk_org_member_organization_user');
    expect(ddl).not.toMatch(/^\s*id\s+uuid/m);

    const org = read('lib/db/schema/org.ts');
    const memberStart = org.indexOf("pgTable(\n  'organization_member'");
    expect(memberStart).toBeGreaterThan(0);
    const memberEnd = org.indexOf("pgTable(\n  'invite'", memberStart);
    const member = org.slice(
      memberStart,
      memberEnd < 0 ? undefined : memberEnd
    );
    expect(member).not.toContain('uuidPk()');
    expect(member).toContain(
      'primaryKey({ columns: [t.organizationId, t.userId] })'
    );
    expect(member).not.toContain('uk_org_member_organization_user');
  });

  test('B4-4：organizations 补齐基线的 created_by（text, SET NULL）', () => {
    const org = read('lib/db/schema/org.ts');
    const start = org.indexOf("pgTable(\n  'organization'");
    expect(org.slice(start)).toMatch(/createdBy: text\('created_by'\)/);
    // 与基线一致：可空 + SET NULL，不写 notNull。
    expect(org.slice(start)).toMatch(
      /createdBy: text\('created_by'\)\.references\(\(\) => users\.id, \{\s*onDelete: 'set null',\s*\}\)/
    );
  });

  test('B4-5：插件的五个 API 调用点全部改为自有路径', () => {
    const actions = stripComments(read('lib/org/actions.ts'));
    expect(actions).not.toContain('getAuth().api.createOrganization');
    expect(actions).not.toContain('getAuth().api.updateOrganization');
    expect(actions).not.toContain('getAuth().api.removeMember');
    expect(actions).not.toContain('getAuth().api.updateMemberRole');
    // 建组织走 SECDEF 的 app.create_organization（附录 A.6，基线 590 行）。
    expect(actions).toContain('app.create_organization');
    // 成员寻址改按 userId（代理主键已删）。
    expect(actions).not.toContain('memberIdOrEmail');
    expect(actions).toContain('eq(orgMembers.userId');

    const members = stripComments(read('lib/org/members.ts'));
    expect(members).not.toContain('getAuth()');
    expect(members).not.toContain('listMembers');
    expect(members).toContain('withOrg');

    const seed = stripComments(read('lib/db/seed.ts'));
    expect(seed).not.toContain('updateOrganization');
  });

  test('B4-6：adapter schema map 收敛为核心四模型', () => {
    const map = stripComments(read('lib/db/auth-schema.ts'));
    expect(map).not.toContain('organization: organizations');
    expect(map).not.toContain('member: orgMembers');
    expect(map).not.toContain('invitation: invitations');
    for (const key of [
      'user: users',
      'session: sessions',
      'account: accounts',
      'verification: verifications',
    ]) {
      expect(map).toContain(key);
    }
  });
});
