#!/usr/bin/env node
/**
 * S8 目标态验收脚本（阶段 D / T36–T42 的执行者）。
 *
 * 与 verify-deployment.mjs（查运行期部署）分工不同：这里在**自建的干净 PG18 库**
 * 上从唯一基线重建目标态，再逐条断言 DDL / 约束 / 隔离语义。默认库名固定为
 * gramps_s8_verify，脚本会 DROP + CREATE 它——不要把它指向任何真实数据库。
 *
 * T40 的 EXPLAIN 性能数字必须在 G1 书面确认的目标环境重跑（实施计划 §6 / §9
 * 「纸面数字不算兑现」），本地容器值不作验收依据，所以 --explain 恒为 SKIP。
 *
 * --parity 是 T39 后半：把 0000_snapshot.json（drizzle-kit 从 schema TS 导出的
 * 结构化镜像，由 CI 的 db:generate 零漂移反向钉住）与本次落库的真实 catalog
 * 逐表对比「表集合 / 列集合 / 主键列组 / 外键定义」。只比结构、不比约束名——
 * TS 具名 CHECK、FK 与基线的内联无名约束天然同名不了，命名差异由 B1 评审登记，
 * 约束的**行为**由 T38 正反例的 SQLSTATE 断言覆盖。auth.* 四表按规格决议 ②
 * 由 Better Auth 管理 DDL，仓内只有 TS 镜像，不纳入对比。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadEnv } from './load-env.mjs';

loadEnv();

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VERIFY_DB = 'gramps_s8_verify';

const HELP = `用法: node scripts/verify-target-schema.mjs [选项]

在自建干净库 ${VERIFY_DB} 上重建 S8 目标基线并验收。
默认执行 --ddl / --assertions / --parity / --security；--explain 恒为 SKIP
（T40 需目标环境）。

选项:
  --help                 显示本帮助
  --all                  默认；DDL + 正反例 + 结构对比 + 安全用例
  --ddl                  T37：执行唯一基线，断言 0 ERROR 与对象数量
  --assertions           T38：逐条执行正例 / 反例并比对期望结果
  --parity               T39 后半：schema TS ↔ SQL 基线落库 catalog 直接对比
  --security             T41：fail-closed 三项断言
  --explain              T40：显式 SKIP（需目标环境，不沿用容器旧数字）
  --url <postgres-url>   superuser 连接串（默认 VERIFY_POSTGRES_URL / POSTGRES_URL）
  --keep                 结束时不删除 ${VERIFY_DB}（默认删除）

输出 PASS / FAIL / SKIP 与汇总；有 FAIL 时退出码 1。

T38 夹具用 -- @case / @expect / @desc 三行标注：
  @expect <5 位 SQLSTATE>  该语句必须报指定 SQLSTATE
  @expect OK               必须无错返回；语义断言写在 SQL 的 DO 块里
  @expect SKIP             结构性不可表达或依赖 T40 目标环境，显式登记不计 PASS

覆盖范围（诚实声明）：P1–P32 / N1–N31 已全量编号落地，其中需目标环境
EXPLAIN 数字的 P21 / P22 与结构性不可表达的 N20 显式 SKIP；T40 恒 SKIP。`;

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const has = (flag) => args.includes(flag);
const runAll = args.length === 0 || has('--all');
const wantDdl = runAll || has('--ddl');
const wantAssertions = runAll || has('--assertions');
const wantParity = runAll || has('--parity');
const wantSecurity = runAll || has('--security');

let passed = 0;
let failed = 0;
let skipped = 0;

function pass(label, detail = '') {
  passed += 1;
  console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
}

function fail(label, detail = '') {
  failed += 1;
  console.log(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
}

function skip(label, reason) {
  skipped += 1;
  console.log(`SKIP ${label}: ${reason}`);
}

function check(condition, label, detail = '') {
  if (condition) {
    pass(label, detail);
  } else {
    fail(label, detail);
  }
  return condition;
}

function derive(url, database) {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

function read(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

/** 解析 `-- @case / @expect / @desc` 标注的可执行 SQL 夹具。 */
function parseCases(text) {
  const cases = [];
  let current = null;
  for (const line of text.split('\n')) {
    const start = line.match(/^--\s*@case\s+(\S+)\s*$/);
    if (start) {
      if (current) {
        cases.push(current);
      }
      current = { id: start[1], expect: '', desc: '', sql: [] };
      continue;
    }
    if (!current) {
      continue;
    }
    const expect = line.match(/^--\s*@expect\s+(\S+)\s*$/);
    if (expect) {
      current.expect = expect[1];
      continue;
    }
    const desc = line.match(/^--\s*@desc\s+(.*)$/);
    if (desc) {
      current.desc = desc[1];
      continue;
    }
    if (/^\s*(--|$)/.test(line)) {
      continue;
    }
    current.sql.push(line);
  }
  if (current) {
    cases.push(current);
  }
  return cases.map((item) => ({ ...item, sql: item.sql.join('\n').trim() }));
}

/**
 * 每个 case 在显式事务里跑完再 ROLLBACK：既让 setup 与失败语句互相可见，
 * 又保证「本该失败却成功」的 case 不会污染后续用例。max:1 保证同一连接。
 */
async function runIsolated(sql, body) {
  await sql.unsafe('begin');
  let code = null;
  let message = '';
  try {
    await sql.unsafe(body);
  } catch (error) {
    code = error?.code ?? null;
    message = error?.message ?? String(error);
  } finally {
    await sql.unsafe('rollback');
  }
  return { code, message };
}

/**
 * 任何验收模式都要先在干净库重建目标态——单独 `--assertions`（T38 的验证
 * 命令）也必须能跑，否则 seed 会直接报「表不存在」。对象数量断言只在
 * `--ddl` / `--all` 下报告，避免其它模式的输出混入 T37 结论。
 */
async function verifyDdl(sql, withObjectChecks) {
  const ddl = read('lib/db/migrations/0000_target_schema.sql');
  let ddlError = null;
  try {
    await sql.unsafe(ddl);
  } catch (error) {
    ddlError = error;
  }
  if (ddlError) {
    fail('T37 唯一基线 0 ERROR', `${ddlError.code ?? ''} ${ddlError.message}`);
    return false;
  }

  if (!withObjectChecks) {
    pass('T36 干净库已重建目标态', `${ddl.split('\n').length} 行 DDL 执行成功`);
    return true;
  }
  pass('T37 唯一基线 0 ERROR', `${ddl.split('\n').length} 行 DDL 全部执行成功`);

  const [tables] = await sql`
    select count(*)::int as n from pg_tables where schemaname = 'public'
  `;
  const [functions] = await sql`
    select count(*)::int as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
  `;
  const [policies] = await sql`
    select count(*)::int as n from pg_policies where schemaname = 'public'
  `;
  check(tables.n === 17, 'T37 业务表 17 张', String(tables.n));
  check(functions.n >= 12, 'T37 app.* 函数 >= 12', String(functions.n));
  check(policies.n === 17, 'T37 RLS 策略 17 条', String(policies.n));
  return true;
}

async function seed(sql) {
  await sql.unsafe(read('tests/fixtures/target-schema-seed.sql'));
}

/**
 * 跑一份 T38 夹具。@expect 三种形态：
 *   5 位 SQLSTATE —— 该语句必须失败且报对应码（反例）
 *   OK            —— 必须无错返回；语义断言写在 SQL 的 DO 块里（正例）
 *   SKIP          —— 结构性不可表达 / 依赖 T40 目标环境，显式登记不计 PASS
 */
async function runFixture(sql, file, tag) {
  const cases = parseCases(read(file));
  let checked = 0;
  let skipped = 0;
  let mismatch = 0;
  for (const item of cases) {
    const label = `T38-${tag} ${item.id}`;
    if (!item.expect) {
      fail(`${label} 夹具元数据不全`, '@expect 缺失');
      mismatch += 1;
      continue;
    }
    if (item.expect === 'SKIP') {
      skip(label, item.desc || '结构性不可表达 / 依赖 T40 目标环境');
      skipped += 1;
      continue;
    }
    if (!item.sql || (item.expect !== 'OK' && !/^\d{5}$/.test(item.expect))) {
      fail(`${label} 夹具元数据不全`, `SQL / @expect 非法：${item.expect}`);
      mismatch += 1;
      continue;
    }
    const { code, message } = await runIsolated(sql, item.sql);
    const expected = item.expect === 'OK' ? null : item.expect;
    checked += 1;
    if (code === expected) {
      pass(`${label} ${item.expect}`, item.desc);
    } else {
      const actual =
        code === null
          ? '无错误（语句成功返回）'
          : `${code} · ${message.slice(0, 120)}`;
      fail(`${label} 期望 ${item.expect}`, `实际 ${actual} · ${item.desc}`);
      mismatch += 1;
    }
  }
  return { total: cases.length, checked, skipped, mismatch };
}

async function verifyAssertions(sql) {
  const negative = await runFixture(
    sql,
    'tests/fixtures/target-schema-negative.sql',
    'N'
  );
  const positive = await runFixture(
    sql,
    'tests/fixtures/target-schema-positive.sql',
    'P'
  );
  for (const [tag, result] of [
    ['反例', negative],
    ['正例', positive],
  ]) {
    check(
      result.mismatch === 0,
      `T38 ${tag} 0 mismatch`,
      `${result.checked} 条执行 / ${result.skipped} 条 SKIP / 共 ${result.total} 条`
    );
  }
}

/** pg_constraint.confdeltype → drizzle snapshot 的 onDelete 取值。 */
const DELETE_ACTION = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

/** 归一化一条外键：只比结构（目标表 / 两组列 / 删除动作），不比约束名。 */
function fkKey(shape) {
  return JSON.stringify([
    shape.tableTo,
    shape.columnsFrom ?? [],
    shape.columnsTo ?? [],
    (shape.onDelete ?? 'no action').toLowerCase(),
  ]);
}

function sameSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * T39 后半：schema TS ↔ SQL 基线落库 catalog 的直接对比。
 *
 * 用 0000_snapshot.json 作为 TS schema 的结构化镜像（CI 的 db:generate 零漂移
 * 反向钉住它 ≡ TS），对比对象却是本次真实执行 DDL 后的 pg_catalog，而不是
 * snapshot 自身——所以这不是「TS ↔ snapshot」的间接自证。
 *
 * 只比结构：TS 具名 CHECK / FK 与基线内联无名约束天然同名不了（B1 评审 Minor
 * ① 已登记），逐名比对只会制造假红；约束的行为由 T38 的 SQLSTATE 断言覆盖。
 * auth.* 四表按规格决议 ② DDL 归 Better Auth，仓内仅 TS 镜像，故排除。
 */
async function verifyParity(sql) {
  const snapshot = JSON.parse(
    read('lib/db/migrations/meta/0000_snapshot.json')
  );
  const snapTables = Object.entries(snapshot.tables)
    .filter(([key]) => key.startsWith('public.'))
    .map(([, value]) => value)
    .sort((a, b) => a.name.localeCompare(b.name));

  const tables = await sql`
    select tablename as name from pg_tables where schemaname = 'public' order by 1
  `;
  const columns = await sql`
    select table_name as tbl, column_name as name
      from information_schema.columns
     where table_schema = 'public'
     order by table_name, ordinal_position
  `;
  const primaryKeys = await sql`
    select c.relname as tbl,
           (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality x(attnum, ord)
              join pg_attribute a
                on a.attrelid = con.conrelid and a.attnum = x.attnum) as cols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and con.contype = 'p'
  `;
  const foreignKeys = await sql`
    select c.relname as tbl, r.relname as ref_tbl, con.confdeltype as del,
           (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality x(attnum, ord)
              join pg_attribute a
                on a.attrelid = con.conrelid and a.attnum = x.attnum) as cols_from,
           (select array_agg(a.attname order by x.ord)
              from unnest(con.confkey) with ordinality x(attnum, ord)
              join pg_attribute a
                on a.attrelid = con.confrelid and a.attnum = x.attnum) as cols_to
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_class r on r.oid = con.confrelid
     where n.nspname = 'public' and con.contype = 'f'
  `;

  const groupBy = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.tbl)) map.set(row.tbl, []);
      map.get(row.tbl).push(row);
    }
    return map;
  };
  const colMap = groupBy(columns);
  const pkMap = groupBy(primaryKeys);
  const fkMap = groupBy(foreignKeys);

  const snapNames = snapTables.map((t) => t.name).sort();
  const dbNames = tables.map((t) => t.name).sort();
  check(
    sameSet(snapNames, dbNames),
    'T39 parity 表集合',
    `${snapNames.length} 张 public 表 · TS-only: ${snapNames.filter((n) => !dbNames.includes(n))} · DDL-only: ${dbNames.filter((n) => !snapNames.includes(n))}`
  );

  let badTables = 0;
  for (const t of snapTables) {
    const problems = [];

    const snapCols = Object.keys(t.columns).sort();
    const dbCols = (colMap.get(t.name) ?? []).map((c) => c.name).sort();
    if (!sameSet(snapCols, dbCols)) {
      problems.push(
        `列 TS-only=[${snapCols.filter((c) => !dbCols.includes(c))}] DDL-only=[${dbCols.filter((c) => !snapCols.includes(c))}]`
      );
    }

    const snapPk = [
      ...Object.values(t.columns)
        .filter((c) => c.primaryKey)
        .map((c) => c.name),
      ...Object.values(t.compositePrimaryKeys ?? {}).flatMap(
        (pk) => pk.columns ?? []
      ),
    ].sort();
    const dbPk = [
      ...new Set((pkMap.get(t.name) ?? []).flatMap((r) => r.cols ?? [])),
    ].sort();
    if (!sameSet(snapPk, dbPk)) {
      problems.push(`主键 TS=[${snapPk}] DDL=[${dbPk}]`);
    }

    const snapFk = Object.values(t.foreignKeys ?? {})
      .map((fk) =>
        fkKey({
          tableTo: fk.tableTo,
          columnsFrom: fk.columnsFrom,
          columnsTo: fk.columnsTo,
          onDelete: fk.onDelete,
        })
      )
      .sort();
    const dbFk = (fkMap.get(t.name) ?? [])
      .map((r) =>
        fkKey({
          tableTo: r.ref_tbl,
          columnsFrom: r.cols_from,
          columnsTo: r.cols_to,
          onDelete: DELETE_ACTION[r.del] ?? r.del,
        })
      )
      .sort();
    if (!sameSet(snapFk, dbFk)) {
      problems.push(
        `外键 TS-only=[${snapFk.filter((k) => !dbFk.includes(k))}] DDL-only=[${dbFk.filter((k) => !snapFk.includes(k))}]`
      );
    }

    if (problems.length > 0) {
      badTables += 1;
      fail(`T39 parity ${t.name}`, problems.join(' | '));
    }
  }
  check(
    badTables === 0,
    'T39 parity 逐表结构',
    `${snapTables.length} 张表的列 / 主键 / 外键全部一致`
  );
}

async function verifySecurity(sql) {
  // 准备一个账号：signup 触发器会顺带建个人组织与 owner 成员行。
  await sql`
    insert into auth.user (id, email, name)
    values ('u-s8-verify', 'verify@example.com', '验收账号')
    on conflict (id) do nothing
  `;
  const [before] = await sql`
    select count(*)::int as n from organization_member
  `;

  // ① 伪造 pg_temp.invite 试图跨租户提权。
  // app.accept_invite 的 search_path 把 pg_temp 置末且关系名 schema-qualified，
  // 所以读到的是 public.invite；伪造表里那条 'pwned' 不应生效。
  const forged = await runIsolated(
    sql,
    `select set_config('app.user_id', 'u-s8-verify', true);
     create temp table invite (token_hash text, organization_id uuid, email text, role text);
     insert into pg_temp.invite values ('pwned', '11111111-1111-1111-1111-111111111111', 'victim@example.com', 'owner');
     select app.accept_invite('pwned');`
  );
  check(
    forged.code === '22023',
    'T41 伪造 pg_temp.invite → 22023',
    forged.code ?? '无错误'
  );
  const [after] = await sql`
    select count(*)::int as n from organization_member
  `;
  check(
    after.n === before.n,
    'T41 伪造邀请未产生跨租户成员行',
    `${before.n} → ${after.n}`
  );

  // ② 未授权角色查询业务表 → 42501。
  await sql.unsafe('drop role if exists s8_verify_nobody');
  await sql.unsafe('create role s8_verify_nobody nologin');
  const denied = await runIsolated(
    sql,
    'set local role s8_verify_nobody; select count(*) from person;'
  );
  check(
    denied.code === '42501',
    'T41 未授权角色查询 → 42501',
    denied.code ?? '无错误'
  );
  await sql.unsafe('drop role if exists s8_verify_nobody');

  // ③ SET LOCAL 与业务 SQL 同事务生效，且不泄漏到下一事务。
  let withGuc = null;
  await sql.unsafe('begin');
  try {
    await sql.unsafe('set local role genealogy_app');
    await sql.unsafe("select set_config('app.user_id', 'u-s8-verify', true)");
    const rows = await sql.unsafe(
      "select current_user as role, current_setting('app.user_id', true) as sub, cardinality(app.visible_org_array()) as orgs"
    );
    withGuc = rows[0];
  } finally {
    await sql.unsafe('rollback');
  }
  check(
    withGuc?.role === 'genealogy_app' && withGuc?.sub === 'u-s8-verify',
    'T41 SET LOCAL 角色与 GUC 同事务生效',
    `${withGuc?.role} / ${withGuc?.sub}`
  );
  check(
    Number(withGuc?.orgs) >= 1,
    'T41 已认证会话可见个人组织',
    String(withGuc?.orgs)
  );

  let noGuc = null;
  await sql.unsafe('begin');
  try {
    await sql.unsafe('set local role genealogy_app');
    const rows = await sql.unsafe(
      'select cardinality(app.visible_org_array()) as orgs, (select count(*) from person)::int as people'
    );
    noGuc = rows[0];
  } finally {
    await sql.unsafe('rollback');
  }
  check(
    Number(noGuc?.orgs) === 0 && Number(noGuc?.people) === 0,
    'T41 未注入 GUC 时 fail-closed（0 组织 / 0 行）',
    `${noGuc?.orgs} / ${noGuc?.people}`
  );
}

async function main() {
  if (has('--help')) {
    console.log(HELP);
    return;
  }

  const sourceUrl =
    argValue('--url') ??
    process.env.VERIFY_POSTGRES_URL ??
    process.env.POSTGRES_URL ??
    '';
  if (!sourceUrl) {
    fail('数据库连接串', '需要 --url 或 VERIFY_POSTGRES_URL / POSTGRES_URL');
    return;
  }

  const adminUrl = derive(sourceUrl, 'postgres');
  const verifyUrl = derive(sourceUrl, VERIFY_DB);
  const keep = has('--keep');

  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${VERIFY_DB}" with (force)`);
    await admin.unsafe(`create database "${VERIFY_DB}"`);
    pass('T36 干净库准备', VERIFY_DB);
  } finally {
    await admin.end();
  }

  const sql = postgres(verifyUrl, { max: 1, onnotice: () => {} });
  try {
    // 总是重建目标态：单独 --assertions / --security 也依赖这些表。
    const ok = await verifyDdl(sql, wantDdl);
    if (!ok) {
      return;
    }
    if (wantAssertions || wantSecurity) {
      await seed(sql);
    }
    if (wantAssertions) {
      await verifyAssertions(sql);
    }
    if (wantParity) {
      await verifyParity(sql);
    }
    if (wantSecurity) {
      await verifySecurity(sql);
    }
    if (has('--explain') || runAll) {
      skip(
        'T40 EXPLAIN / Q1 / Q3 数字',
        '需在 G1 书面确认的目标环境重跑，本地容器数字不作验收依据'
      );
    }
  } finally {
    await sql.end();
    if (!keep) {
      const cleanup = postgres(adminUrl, { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(
          `drop database if exists "${VERIFY_DB}" with (force)`
        );
      } finally {
        await cleanup.end();
      }
    }
  }

  console.log(`\n${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  fail('验收脚本异常', error?.message ?? String(error));
  process.exitCode = 1;
});
