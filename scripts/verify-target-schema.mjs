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
默认执行 --ddl / --assertions / --security；--explain 恒为 SKIP（T40 需目标环境）。

选项:
  --help                 显示本帮助
  --all                  默认；DDL + 反例断言 + 安全用例
  --ddl                  T37：执行唯一基线，断言 0 ERROR 与对象数量
  --assertions           T38：逐条执行反例并比对期望 SQLSTATE
  --security             T41：fail-closed 三项断言
  --explain              T40：显式 SKIP（需目标环境，不沿用容器旧数字）
  --url <postgres-url>   superuser 连接串（默认 VERIFY_POSTGRES_URL / POSTGRES_URL）
  --keep                 结束时不删除 ${VERIFY_DB}（默认删除）

输出 PASS / FAIL / SKIP 与汇总；有 FAIL 时退出码 1。

覆盖范围（诚实声明）：本批只落地 T38 反例第一批。P1–P32 正例与其余 N 场景
尚未编写，脚本会打印 SKIP，不把「本批通过」伪装成「全量验收通过」。`;

function argValue(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const has = (flag) => args.includes(flag);
const runAll = args.length === 0 || has('--all');
const wantDdl = runAll || has('--ddl');
const wantAssertions = runAll || has('--assertions');
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

async function verifyAssertions(sql) {
  const cases = parseCases(read('tests/fixtures/target-schema-negative.sql'));
  let mismatch = 0;
  for (const item of cases) {
    if (!(item.expect && item.sql)) {
      fail(`T38 ${item.id} 夹具元数据不全`, '@expect / SQL 缺失');
      mismatch += 1;
      continue;
    }
    const { code, message } = await runIsolated(sql, item.sql);
    if (code === item.expect) {
      pass(`T38 ${item.id} ${item.expect}`, item.desc);
    } else {
      fail(
        `T38 ${item.id} 期望 ${item.expect}`,
        `实际 ${code ?? '无错误'}${code ? '' : ` · ${message.slice(0, 120)}`} · ${item.desc}`
      );
      mismatch += 1;
    }
  }
  check(mismatch === 0, 'T38 反例 0 mismatch', `${cases.length} 条`);
  skip(
    'T38 P1–P32 正例与其余 N 场景',
    '本批只落地反例第一批，正例夹具与剩余场景待后续批次'
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
