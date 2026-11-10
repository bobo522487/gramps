/**
 * 角色 provisioning 的判定与执行：读属性、算差异、按需 ALTER。
 *
 * 抽成独立模块的唯一理由：`scripts/provision-roles.mjs` 解析 argv、连库、
 * `process.exit`，没法在单测里验证行为，只能拿正则 grep 源码。这里不读环境
 * 变量、不建连接（`sql` 由调用方注入），于是「口令缺失时到底会不会发出
 * ALTER」这类问题可以直接断言——而这正是 2026-11-09 漏掉的风险：
 * `AUTH_DB_PASSWORD ?? 'auth'` 在缺变量时静默把认证角色改成 4 字符口令。
 */

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
 * 已存在且属性合规 → 直接返回 `ok（属性已合规）`，不发 ALTER（见 describeRole）。
 * 已存在且属性不合规 → 尝试修；改不动就如实报「修不了」，由调用方决定是否致命。
 *
 * `password` 为空表示**本次不改口令**。调用方拿不到口令时必须传空，不许用
 * 默认值兜底：口令是「每个环境一份」的部署配置，猜一个弱口令写进生产角色，
 * 比明确跳过危险得多。
 */
export async function ensureRole(sql, name, { login, password }) {
  const current = await describeRole(sql, name);
  if (!current) {
    const attrs = `${login ? 'login' : 'nologin'} nosuperuser nobypassrls`;
    const pwd = password ? ` password ${literal(password)}` : '';
    await sql.unsafe(`create role "${name}" ${attrs}${pwd}`);
    return { status: 'created', canSetPassword: Boolean(password) };
  }

  const fixes = roleFixups(current, { login });
  if (fixes.length > 0) {
    try {
      await sql.unsafe(`alter role "${name}" ${fixes.join(' ')}`);
    } catch (error) {
      // 属性改不动不是致命的：可能是托管库禁止，也可能角色本就该这样。
      // 真正的合规判定交给 verify-deployment.mjs，那里会红。
      const code = error?.code ?? '?';
      return {
        status: `属性不合规且改不动（需要 ${fixes.join(' ')}，SQLSTATE ${code}）`,
        canSetPassword: false,
      };
    }
  }

  // 属性已合规，剩下的只有口令。托管库通常允许这一条。
  if (password) {
    try {
      await sql.unsafe(`alter role "${name}" password ${literal(password)}`);
      return { status: 'ok（属性已合规，口令已更新）', canSetPassword: true };
    } catch (error) {
      const code = error?.code ?? '?';
      return {
        status: `属性已合规，但口令改不动（SQLSTATE ${code}）`,
        canSetPassword: false,
      };
    }
  }
  return {
    status: 'ok（属性已合规，未提供口令，未改口令）',
    canSetPassword: false,
  };
}
