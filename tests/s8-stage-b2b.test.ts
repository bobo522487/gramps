/**
 * S8 阶段 B · B2b：`invite` 三列重写与邀请流程改自建 token。
 *
 * 规格附录 A.1 的 `token_hash`（随机 token 的 sha256）与 Better Auth 邀请插件
 * **机制上不兼容**：插件把 `invitation.id` 当 bearer 凭据——`createInvitation`
 * 返回 id、链接写 `sign-up?invite=<id>`、`acceptInvitation` 按 id 查。而
 * `token_hash` 是不透明哈希，插件既拿不到明文也无法用它寻址。
 *
 * 2026-11-08 负责人拍板：**按规格自建 token 邀请**。放弃插件邀请 API，写入
 * 走附录 A.7 的 `ON CONFLICT` 重发，接受走 `app.accept_invite(token_hash)`。
 *
 * 本文件是静态门禁（读源码断言），不 import 待改模块——B0b 的经验是
 * 「门禁一旦 import 被测模块，重构时先红的是门禁自己的编译错误」。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * 去掉 SQL 的行注释与块注释。
 *
 * 只认 `--`：B0b 的写法直接搬到 TypeScript 上是错的（TS 用 `//`），
 * 而 `--` 不会出现在 Drizzle 链式调用里，所以这里分开成两个函数而不是
 * 一个「通用版」——通用剥注释器在没有词法分析时必然误伤字符串里的内容。
 */
function stripSqlComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)--.*$/gm, '');
}

/**
 * 去掉 TS 的行注释与块注释。
 *
 * 为什么必须剥：`tokenHash` 到 `.default(` 之间那一段解释性注释有几百字，
 * 不剥的话「属性名在后 600 字符内跟上了 .default() 与 .unique()」这类
 * 结构断言会被注释长度左右——解释写详细一点测试就红，等于逼人不写注释。
 */
function stripTsComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

const ddl = read('lib/db/migrations/0000_target_schema.sql');
const ddlCode = stripSqlComments(ddl);
const schema = read('lib/db/schema/org.ts');
const schemaCode = stripTsComments(schema);

describe('S8 阶段 B · B2b 邀请改自建 token', () => {
  test('B2b-1：TS 的 invite 表与附录 A.1 列形状一致', () => {
    // 目标态三列：token_hash（不是令牌本体）、accepted_at、invited_by text。
    // 旧实现的 inviterId 是 NOT NULL + RESTRICT，与「账号注销后邀请仍要留痕」
    // 相反——加号人没了不该把整条邀请删掉。
    expect(schemaCode).toContain("tokenHash: text('token_hash')");
    expect(schemaCode).toContain("acceptedAt: timestamptz('accepted_at')");
    expect(schemaCode).toContain("invitedBy: text('invited_by')");
    expect(schemaCode).not.toContain('inviterId');
    expect(schemaCode).not.toContain('inviter_id');
    // 允许为空 + SET NULL：与基线的 invite_invited_by_fkey 一致。
    expect(schemaCode).toMatch(
      /invitedBy: text\('invited_by'\)[\s\S]{0,120}?onDelete: 'set null'/
    );
  });

  test('B2b-2：状态值域与基线 CHECK 一致，不是插件的取值', () => {
    // 插件自己会写 'pending' / 'accepted' / 'rejected' / 'canceled'，
    // 基线是 'pending' / 'accepted' / 'revoked'。两套并存时，插件写的
    // 'rejected' 会撞 23514——TS 必须跟基线，不是跟插件。
    const statusCheck = /ck_invite_status[\s\S]{0,200}?\]/.exec(schemaCode);
    expect(statusCheck, 'ck_invite_status 必须存在').not.toBeNull();
    const block = statusCheck?.[0] ?? '';
    for (const value of ['pending', 'accepted', 'revoked']) {
      expect(block, value).toContain(`'${value}'`);
    }
    expect(block).not.toContain("'rejected'");
    expect(block).not.toContain("'canceled'");
    // 基线里对应的是同三个值，两边不能各写一套。
    expect(ddlCode).toMatch(
      /CHECK \(status IN \('pending','accepted','revoked'\)\)/
    );
  });

  test('B2b-3：唯一约束按 (organization_id, email) 全量唯一', () => {
    // 基线是 `CONSTRAINT invite_email_unique UNIQUE (organization_id, email)`，
    // 无软删后不再需要 `where status = 'pending'` 的部分索引：重发走
    // ON CONFLICT 原地更新同一行，不需要同邮箱两条 pending。
    expect(ddlCode).toContain(
      'CONSTRAINT invite_email_unique UNIQUE (organization_id, email)'
    );
    expect(schemaCode).toContain("unique('uk_invite_org_email')");
    expect(schemaCode).not.toContain('uk_invite_pending_email');
  });

  test('B2b-4：token_hash 全局唯一，撞车能被应用捕获重试', () => {
    // 具名约束：应用靠这个名字认出「token 撞车，重生成即可重试」。
    // 内联 `UNIQUE` 由 PostgreSQL 自动起名（实测也叫 invite_token_hash_key），
    // 但自动名不是契约——换个建表顺序就可能变，所以显式钉住。
    expect(ddlCode).toMatch(
      /token_hash\s+text NOT NULL\s+DEFAULT [\s\S]{0,90}?CONSTRAINT invite_token_hash_key UNIQUE/
    );
    // 默认值不是给「忘了传 token」留后路——业务代码每处插入都显式写它。
    // 它存在是为了让 Better Auth 1.7.12 的 schema 自检放过这一列
    // （插件不写 token_hash，遇到「非空 + 无默认值」就判定每次插入都会失败，
    // 而自检命中会**抛异常**并阻断所有写事务）。
    expect(ddlCode).not.toContain('gen_random_bytes');
    // 用内置 `gen_random_uuid()`，不引入 pgcrypto：为一个占位默认值多装一个
    // 扩展等于白白扩大攻击面。
    expect(ddlCode).toContain('gen_random_uuid()');
    // TS 侧形状：非空 + 默认值 + unique()。默认值上面解释了，这里一并钉住，
    // 免得有人「清理」它之后又被 Better Auth 的自检在整个 CI 上炸一遍。
    expect(schemaCode).toMatch(
      /tokenHash: text\('token_hash'\)[\s\S]{0,600}?\.default\([\s\S]{0,300}?\.unique\(\)/
    );
    // 附录 A.7 明写：撞到另一封邀请时抛 ON CONFLICT 捕不到的 23505，
    // 由应用重新生成 token 重试。约束名必须可预测，否则重试分支认不出它。
    expect(ddlCode).toContain('invite_token_hash_key');
  });

  test('B2b-5：邀请写入走附录 A.7 的 ON CONFLICT 重发', () => {
    const invitations = read('lib/org/invitations.ts');
    // 重发 = 换 token + 续期 + 置回 pending，role 不静默改。
    expect(invitations).toContain('onConflictDoUpdate');
    expect(invitations).toMatch(/tokenHash:\s*sql`excluded\.token_hash`/);
    expect(invitations).toMatch(/expiresAt:\s*sql`excluded\.expires_at`/);
    expect(invitations).toMatch(/status:\s*'pending'/);
    expect(invitations).toMatch(/acceptedAt:\s*null/);
    // role 刻意不在 SET 里——重发不该改角色。
    const conflictSet = /onConflictDoUpdate\(\{[\s\S]*?\}\)/.exec(invitations);
    expect(conflictSet, '必须有 onConflictDoUpdate').not.toBeNull();
    expect(conflictSet?.[0] ?? '').not.toMatch(/\brole:/);
    // A.7 的 WHERE accepted_at IS NULL：已接受的邀请重发必须是 0 行，
    // 由应用检查 rowcount 报业务错误，而不是静默把已加入的人退回 pending。
    //
    // 必须锚定 `where:` 这个**键**而不是裸的 `accepted_at is null`：
    // 后者的弱点是源码里任何一处注释、任何一次别的查询提到它就通过——
    // 变异验证时删掉 `where:` 那一行、注释里仍留着同样字样，断言照样绿。
    const conflictBlock = /onConflictDoUpdate\(\{[\s\S]*?\n\s*\}\)/.exec(
      invitations
    );
    expect(conflictBlock, '必须有 onConflictDoUpdate').not.toBeNull();
    expect(conflictBlock?.[0] ?? '').toMatch(
      /where:\s*sql`\$\{invitations\.acceptedAt\} is null`/
    );
  });

  test('B2b-5b：重发命中已接受邀请时报业务错误，不当成成功', () => {
    // `.returning()` 返回 0 行是 A.7 的 `WHERE accepted_at IS NULL` 在起作用，
    // 唯一正确的反应是把它当失败上报。如果这里改成「0 行也算成功」，管理员
    // 会拿到一条永远用不了的邀请链接，而界面显示「邀请已创建」——最难查的
    // 那种故障：错误发生在正确的地方，只是被吞掉了。
    const invitations = read('lib/org/invitations.ts');
    const block = /if \(rows\.length === 0\) \{([\s\S]{0,200}?)\}/.exec(
      invitations
    );
    expect(block, '必须有 rows.length === 0 的分支').not.toBeNull();
    expect(block?.[1] ?? '').toMatch(/ok:\s*false/);
    expect(block?.[1] ?? '').toContain("reason: 'accepted'");

    // 应用层要把这个分支翻成人话，而不是落进兜底文案。
    const actions = read('lib/org/actions.ts');
    expect(actions).toContain("issued.reason === 'accepted'");
    expect(actions).toContain('该邮箱已是成员，无需重复邀请');
  });

  test('B2b-6：链接带明文 token，不再用 invitation.id 当凭据', () => {
    const actions = read('lib/org/actions.ts');
    // 旧写法把插件返回的 uuid 直接当 bearer：`sign-up?invite=<id>`。
    expect(actions).not.toContain('sign-up?invite=');
    expect(actions).toContain('/join?token=');
    // 明文 token 只在创建那一刻出现一次，库里只有 sha256。
    const invitations = read('lib/org/invitations.ts');
    expect(invitations).toContain('createHash');
    expect(invitations).toContain("'sha256'");
    expect(invitations).toContain('randomBytes');
  });

  test('B2b-7：接受邀请改走 app.accept_invite，不再用插件 API', () => {
    const actions = read('lib/org/actions.ts');
    expect(actions).toContain('app.accept_invite(');
    // 插件的 acceptInvitation / getInvitation 在自建 token 下再也拿不到
    // 正确的凭据，留着就是一条走不通的暗路。
    expect(actions).not.toContain('api.acceptInvitation');
    expect(actions).not.toContain('api.getInvitation');
    expect(actions).not.toContain('api.createInvitation');
    expect(actions).not.toContain('api.cancelInvitation');
  });

  test('B2b-8：待加入者靠 SECURITY DEFINER 预览，不放开整表可见性', () => {
    // 接受之前他不是成员，org_isolation 让他在 invite 上看不见任何行。
    // 放开 SELECT 等于把「同组织所有待发邀请的邮箱」暴露给他。
    expect(ddlCode).toContain(
      'CREATE OR REPLACE FUNCTION app.invite_join_preview(p_token_hash text)'
    );
    const fn = ddlCode.slice(
      ddlCode.indexOf('FUNCTION app.invite_join_preview'),
      ddlCode.indexOf(
        '$$;',
        ddlCode.indexOf('FUNCTION app.invite_join_preview')
      )
    );
    expect(fn).toMatch(/SECURITY DEFINER/);
    // 只回组织名与角色，不回邮箱、不回其他成员。
    expect(fn).toContain('o.name');
    expect(fn).not.toMatch(/\bemail\b/);
    expect(ddlCode).toContain(
      'GRANT EXECUTE ON FUNCTION app.invite_join_preview(text) TO genealogy_app'
    );
  });

  test('B2b-9：app_rw 对 invite 需要 SELECT（成员管理界面自己读表）', () => {
    // B2a 的评审要求 app_rw 对 invite 完全无权限，前提是「邀请走 Better Auth
    // API、业务层不读这张表」。自建 token 后这个前提没了：成员管理页、重发、
    // 撤销都要读 invite。断言反转为「必须可读」，但**仍然不给写**——
    // 写入只能走 A.7 的路径与 app.accept_invite。
    const verify = read('scripts/verify-deployment.mjs');
    expect(verify).toContain(
      "has_table_privilege('app_rw', 'public.invite', 'SELECT') as app_invite_select"
    );
    expect(verify).toMatch(/privileges\?\.app_invite_select === true/);
    expect(verify).not.toMatch(/privileges\?\.app_invite_select === false/);

    // 测试库的权限矩阵必须复刻同一张表，否则「测试通过的形状」和「上线后的
    // 形状」不是同一个东西。这里断言的是行为而不是集合是否为空：
    // `noAccess` 这个集合已随 B2b 清空（它是「谁完全没权限」的名单）。
    const roles = read('tests/helpers/runtime-roles.ts');
    expect(roles).toContain(
      "'GRANT SELECT, INSERT, UPDATE ON public.invite TO app_rw'"
    );
    // 无 DELETE：撤销是置 status，不是删行。删了之后同一 token 会从
    // 「已撤销」退化成「无效」，用户拿到的解释与事实不符。
    expect(roles).not.toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.invite'
    );
    const noAccess =
      /const noAccess = new Set(?:<string>)?\(\[([^\]]*)\]\)/.exec(roles);
    expect(noAccess, 'noAccess 声明必须仍然存在').not.toBeNull();
    expect(noAccess?.[1] ?? '').not.toContain("'invite'");
  });

  test('B2b-10：规格 §9 登记「邀请凭 token 而非行 id」', () => {
    const spec = read('docs/data-model.md');
    expect(spec).toContain('token_hash');
    // 必须写清为什么 id 不能当凭据，否则下一个人会「简化」回去。
    expect(spec).toMatch(/邀请.{0,40}token/i);
  });
});
