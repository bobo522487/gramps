/**
 * 角色 provisioning 的判定与执行：读属性、算差异、按需 ALTER。
 *
 * 抽成独立模块的唯一理由：`scripts/provision-roles.mjs` 解析 argv、连库、
 * `process.exit`，没法在单测里验证行为，只能拿正则 grep 源码。这里不读环境
 * 变量、不建连接（`sql` 由调用方注入），于是「口令缺失时到底会不会发出
 * ALTER」这类问题可以直接断言——而这正是 2026-11-09 漏掉的风险：
 * `AUTH_DB_PASSWORD ?? 'auth'` 在缺变量时静默把认证角色改成 4 字符口令。
 */

import { scramSha256 } from './scram-verifier.mjs';

/** PostgreSQL 字符串字面量转义，供 create/alter role 的 password 子句。 */
export function literal(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * 读角色当前属性。
 *
 * 2026-11-09 生产实测的教训：Neon 对 `ALTER ROLE` 的限制**比原生 PG 严**——
 * `pg_has_role(…,'MEMBER')` / `rolcreaterole` 全判「可」，真跑仍 42501；
 * 但同一事务里 `ALTER ROLE … PASSWORD '…'` 却能过。
 * 也就是说托管库只放行改口令，不放行改属性。
 *
 * 对策不是去猜哪句能过，而是**只改真正需要改的**：属性本来就对就别发这条
 * 语句。生产上这几个角色是控制面建的，LOGIN / NOSUPERUSER / NOBYPASSRLS
 * 本来就是正确配置，于是整段 ALTER 可以完全跳过。
 */
export async function describeRole(sql, name) {
  const [row] = await sql`
    select rolcanlogin, rolsuper, rolbypassrls
    from pg_roles where rolname = ${name}
  `;
  return row ?? null;
}

/** 需要改的属性和目标值，空数组表示已经合规。 */
export function roleFixups(current, want) {
  const fixes = [];
  if (current.rolcanlogin !== want.login) {
    fixes.push(want.login ? 'login' : 'nologin');
  }
  if (current.rolsuper !== false) fixes.push('nosuperuser');
  if (current.rolbypassrls !== false) fixes.push('nobypassrls');
  return fixes;
}

/**
 * 建角色或把它修到目标属性。
 *
 * 属性与口令是**两件独立的事**，返回结构也分开了：
 * - `attributesCompliant`：目标属性是否与库内一致（或已修好）。不合规也不阻止
 *   后面的口令分支——2026-11-09 的 S1 问题就是属性 ALTER 一失败就 return，
 *   本来能改的口令一句没发，还被判致命。
 * - `canSetPassword`：口令是否已设置/已更新，或本次根本没要求改口令。致命判定
 *   只看它（且只在调用方确实给了口令、需要改时），属性不合规交给
 *   `verify-deployment.mjs` 兜底。
 *
 * `password` 为空表示**本次不改口令**。调用方拿不到口令时必须传空，不许用
 * 默认值兜底：口令是「每个环境一份」的部署配置，猜一个弱口令写进生产角色，
 * 比明确跳过危险得多。
 *
 * 口令以 SCRAM-SHA-256 verifier 写入（见 scram-verifier.mjs），SQL 文本里不出现
 * 明文——它本来会落进托管库的查询历史与 log_statement 日志。
 */
export async function ensureRole(sql, name, { login, password }) {
  const current = await describeRole(sql, name);
  if (!current) {
    const attrs = `${login ? 'login' : 'nologin'} nosuperuser nobypassrls`;
    const pwd = password ? ` password ${literal(scramSha256(password))}` : '';
    await sql.unsafe(`create role "${name}" ${attrs}${pwd}`);
    return {
      status: 'created',
      attributesCompliant: true,
      canSetPassword: true,
    };
  }

  const fixes = roleFixups(current, { login });
  let attributesCompliant = fixes.length === 0;
  const notes = [];
  if (fixes.length > 0) {
    try {
      await sql.unsafe(`alter role "${name}" ${fixes.join(' ')}`);
      attributesCompliant = true;
    } catch (error) {
      // 属性改不动不是致命的：可能是托管库禁止，也可能角色本就该这样。
      // 合规判定交给 verify-deployment.mjs，但口令该改还得改。
      const code = error?.code ?? '?';
      notes.push(
        `属性不合规且改不动（需要 ${fixes.join(' ')}，SQLSTATE ${code}）`
      );
    }
  }

  if (!password) {
    return {
      status: attributesCompliant
        ? 'ok（属性已合规，未提供口令，未改口令）'
        : `${notes.join('；')}；未提供口令，未改口令`,
      attributesCompliant,
      // 没要求改口令 → 这一项不该成为致命判定依据。
      canSetPassword: true,
    };
  }

  // 属性可能改不动，但口令这一条通常能过（Neon 实测只放行 PASSWORD），必须独立尝试。
  try {
    await sql.unsafe(
      `alter role "${name}" password ${literal(scramSha256(password))}`
    );
    notes.push('口令已更新');
    return {
      status: attributesCompliant
        ? 'ok（属性已合规，口令已更新）'
        : `${notes.join('；')}`,
      attributesCompliant,
      canSetPassword: true,
    };
  } catch (error) {
    const code = error?.code ?? '?';
    notes.push(`口令改不动（SQLSTATE ${code}）`);
    return {
      status: notes.join('；'),
      attributesCompliant,
      canSetPassword: false,
    };
  }
}
