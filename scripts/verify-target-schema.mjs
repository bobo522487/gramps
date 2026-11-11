#!/usr/bin/env node
/**
 * S8 目标态验收脚本（阶段 D / T36–T42 的执行者）。
 *
 * 与 verify-deployment.mjs（查运行期部署）分工不同：这里在**自建的干净 PG18 库**
 * 上从唯一基线重建目标态，再逐条断言 DDL / 约束 / 隔离语义。默认库名固定为
 * gramps_s8_verify，脚本会 DROP + CREATE 它——不要把它指向任何真实数据库。
 *
 * --explain 是 T40：自建一套独立 org / project / lineage 与 10 万 person + 10 万
 * node 的压测数据集，以 `genealogy_app` + `SET LOCAL app.user_id` 真正走 RLS，
 * 跑 Q1（整树）/ Q3（子树）两条查询并断言计划形状与耗时。数字随每次运行重测，
 * 文档里的数字只是最近一次实测快照，不是常量。
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
import { globalUniqueIssues, indexParityIssues } from './schema-parity.mjs';

loadEnv();

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const VERIFY_DB = 'gramps_s8_verify';

const HELP = `用法: node scripts/verify-target-schema.mjs [选项]

在自建干净库 ${VERIFY_DB} 上重建 S8 目标基线并验收。
默认执行 --ddl / --assertions / --parity / --security / --explain。

选项:
  --help                 显示本帮助
  --all                  默认；DDL + 正反例 + 结构对比 + 安全用例
  --ddl                  T37：执行唯一基线，断言 0 ERROR 与对象数量
  --assertions           T38：逐条执行正例 / 反例并比对期望结果
  --parity               T39 后半：schema TS ↔ SQL 基线落库 catalog 直接对比
  --security             T41：fail-closed 三项断言
  --explain              T40：建 10 万行压测集，实测 Q1 / Q3 的计划形状与耗时
  --url <postgres-url>   superuser 连接串（默认 VERIFY_POSTGRES_URL / POSTGRES_URL）
  --keep                 结束时不删除 ${VERIFY_DB}（默认删除）

输出 PASS / FAIL / SKIP 与汇总；有 FAIL 时退出码 1。

T38 夹具用 -- @case / @expect / @desc 三行标注：
  @expect <5 位 SQLSTATE>  该语句必须报指定 SQLSTATE
  @expect OK               必须无错返回；语义断言写在 SQL 的 DO 块里
  @expect SKIP             结构性不可表达，显式登记不计 PASS

覆盖范围（诚实声明）：P1–P32 / N1–N31 已全量编号落地，P21 / P22 由 --explain
实跑（整树 / 子树两条查询）；结构性不可表达的 N20 显式 SKIP。
Q3 的计划形状随选择率变化，本脚本只硬断言「InitPlan 生效 + path 谓词被下推 +
< 100ms」，不为了凑出 Index Scan 去改 planner 开关。`;

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
const wantExplain = runAll || has('--explain');

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
  // 全局唯一约束与索引是 parity 缺失的两类执行者：差集计算放在
  // scripts/schema-parity.mjs（纯函数，可离线单测），这里只负责查 catalog。
  const uniqueConstraints = await sql`
    select c.relname as tbl, con.conname as name,
           (select array_agg(a.attname order by x.ord)
              from unnest(con.conkey) with ordinality x(attnum, ord)
              join pg_attribute a
                on a.attrelid = con.conrelid and a.attnum = x.attnum) as cols
      from pg_constraint con
      join pg_class c on c.oid = con.conrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and con.contype = 'u'
  `;
  const indexes = await sql`
    select tablename as tbl, indexname as name
      from pg_indexes
     where schemaname = 'public'
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

  const dbUnique = uniqueConstraints.map((row) => ({
    table: row.tbl,
    name: row.name,
    columns: row.cols ?? [],
  }));
  const dbIndexes = indexes.map((row) => ({
    table: row.tbl,
    name: row.name,
  }));
  const uniqueIssues = globalUniqueIssues(snapshot, dbUnique);
  const indexIssues = indexParityIssues(snapshot, dbIndexes);
  for (const issue of uniqueIssues) {
    check(false, 'T39 parity 全局唯一约束', issue);
  }
  for (const issue of indexIssues) {
    check(false, 'T39 parity 索引', issue);
  }
  check(
    uniqueIssues.length === 0 && indexIssues.length === 0,
    'T39 parity 唯一约束 / 索引',
    '13 张内容表的 UNIQUE (id) 与 TS 声明的索引全部落库'
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

/** T40 压测集规模：10 万 node（外加根节点，共 100001 行）。 */
const EXPLAIN_NODES = 100_000;
const EXPLAIN_SCOPE = {
  org: 'aaaaaaaa-0000-4000-8000-000000000001',
  project: 'aaaaaaaa-0000-4000-8000-000000000002',
  lineage: 'aaaaaaaa-0000-4000-8000-000000000003',
  user: 'u-s8-explain',
};

/**
 * T40 数据夹具：独立一套 org / project / lineage + 10 万 person + 10 万 node。
 * 不复用 target-schema-seed.sql：那棵固定子树被 P14 删除、被 P23 计数，塞十万行
 * 进去只会把断言变成噪声。分层插入（根 → 10 个中层 → 每层 9999 个叶）是为了满足
 * node_parent_fk 的「父路径必须已存在」，也贴合真实谱系的形状。
 * 注意 node_annotation_person 要求 primary 节点必须有 person，所以 person 同量。
 */
async function seedExplainDataset(sql) {
  const { org, project, lineage, user } = EXPLAIN_SCOPE;
  await sql`
    insert into auth.user (id, email, name)
    values (${user}, 'explain@example.com', 'T40 压测账号')
    on conflict (id) do nothing
  `;
  await sql`
    insert into organization (id, name, slug)
    values (${org}, 'T40 压测组织', 't40-explain')
    on conflict (id) do nothing
  `;
  await sql`
    insert into organization_member (organization_id, user_id, role)
    values (${org}, ${user}, 'owner')
    on conflict do nothing
  `;
  await sql`
    insert into project (organization_id, id, name)
    values (${org}, ${project}, 'T40 压测项目')
    on conflict do nothing
  `;
  await sql`
    insert into lineage (organization_id, project_id, id, name)
    values (${org}, ${project}, ${lineage}, 'T40 压测谱系')
    on conflict do nothing
  `;
  await sql`
    insert into person (organization_id, project_id, id)
    select ${org}, ${project},
           ('bbbbbbbb-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
      from generate_series(1, ${EXPLAIN_NODES + 1}::int) n
  `;
  await sql`
    insert into node (organization_id, project_id, lineage_id, path, person_id)
    values (${org}, ${project}, ${lineage}, '0001',
            ('bbbbbbbb-0000-4000-8000-' || lpad(${String(EXPLAIN_NODES + 1)}, 12, '0'))::uuid)
  `;
  await sql`
    insert into node (organization_id, project_id, lineage_id, path, person_id)
    select ${org}, ${project}, ${lineage},
           ('0001.' || lpad(m::text, 4, '0'))::ltree,
           ('bbbbbbbb-0000-4000-8000-' || lpad((99990 + m)::text, 12, '0'))::uuid
      from generate_series(1, 10) m
  `;
  await sql`
    insert into node (organization_id, project_id, lineage_id, path, person_id)
    select ${org}, ${project}, ${lineage},
           ('0001.' || lpad((ceil(i / 9999.0))::int::text, 4, '0') || '.' ||
            lpad((((i - 1) % 9999) + 1)::text, 4, '0'))::ltree,
           ('bbbbbbbb-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid
      from generate_series(1, 99990) i
  `;
  await sql.unsafe('analyze node');
  await sql.unsafe('analyze person');
}

/**
 * 以业务角色跑 EXPLAIN (ANALYZE)：`genealogy_app` + `SET LOCAL app.user_id`，
 * 才会真的走 RLS 的 InitPlan 谓词。属主连接绕过 RLS，其计划不作验收依据。
 */
async function explainAsApp(sql, query) {
  await sql.unsafe('begin');
  try {
    await sql.unsafe('set local role genealogy_app');
    await sql.unsafe(
      `select set_config('app.user_id', '${EXPLAIN_SCOPE.user}', true)`
    );
    const rows = await sql.unsafe(`explain (analyze, format text) ${query}`);
    return rows.map((row) => Object.values(row)[0]).join('\n');
  } finally {
    await sql.unsafe('rollback');
  }
}

function executionMs(plan) {
  const matched = plan.match(/Execution Time: ([\d.]+) ms/);
  return matched ? Number(matched[1]) : null;
}

/** 计划里第一个真正的计划节点（跳过 Aggregate / Sort 之类的包裹层）。 */
function planShape(plan) {
  // 根节点没有前导缩进（psql 的框线是渲染时补的），子节点还带 `-> ` 箭头。
  const line = plan
    .split('\n')
    .find((row) =>
      /^\s*(?:->\s*)?(Index Scan|Index Only Scan|Seq Scan|Bitmap Heap Scan)/.test(
        row
      )
    );
  if (!line) {
    return '未见扫描节点';
  }
  const shape = line.trim().replace(/\s+\(cost=.*$/, '');
  return shape.replace(/\s+\(actual.*$/, '');
}

/**
 * T40：Q1 整树 / Q3 子树。
 *
 * 两条查询都要求 InitPlan 生效（RLS 谓词每次查询只算一次）且 < 100ms；
 * Q1 额外要求 `Index Scan using node_path_unique` 且**无 Sort**——整树按 path
 * 有序，索引顺序即结果顺序，出现 Sort 说明有序扫描丢了。
 *
 * Q3 只硬断言「InitPlan + path 谓词被下推 + < 100ms」：10% 选择率下 planner
 * 合理会选择 Seq Scan + Sort，硬断言 Index Scan 只能靠关 enable_seqscan
 * 凑出来，那是给验收造假。真实形状作为记录输出。
 */
async function verifyExplain(sql) {
  await seedExplainDataset(sql);

  const [total] = await sql`
    select count(*)::int as n from node where project_id = ${EXPLAIN_SCOPE.project}
  `;
  check(
    total.n >= EXPLAIN_NODES,
    'T40 压测集规模 >= 10 万 node',
    `${total.n} 行`
  );

  const { org, project, lineage } = EXPLAIN_SCOPE;
  const q1 = await explainAsApp(
    sql,
    `select id, path from node
      where organization_id = '${org}'
        and project_id = '${project}'
        and lineage_id = '${lineage}'
      order by path`
  );
  const q1Ms = executionMs(q1);
  check(q1.includes('InitPlan 1'), 'T40-P21 InitPlan 生效', planShape(q1));
  check(
    /Index Scan using node_path_unique/.test(q1),
    'T40-P21 整树查询走 node_path_unique',
    planShape(q1)
  );
  check(!/\bSort\b/.test(q1), 'T40-P21 整树查询无 Sort', planShape(q1));
  check(
    q1Ms !== null && q1Ms < 100,
    'T40-P21 Q1 整树 10 万行 < 100ms',
    `${q1Ms} ms`
  );

  const q3 = await explainAsApp(
    sql,
    `select id, path from node
      where organization_id = '${org}'
        and project_id = '${project}'
        and lineage_id = '${lineage}'
        and path <@ '0001.0003'::ltree
      order by path`
  );
  const q3Ms = executionMs(q3);
  check(q3.includes('InitPlan 1'), 'T40-P22 InitPlan 生效', planShape(q3));
  check(
    q3.includes("'0001.0003'::ltree"),
    'T40-P22 子树谓词已下推',
    planShape(q3)
  );
  check(
    q3Ms !== null && q3Ms < 100,
    'T40-P22 Q3 子树 1 万行 < 100ms',
    `${q3Ms} ms（形状：${planShape(q3)}，仅记录）`
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
    if (wantExplain) {
      await verifyExplain(sql);
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
