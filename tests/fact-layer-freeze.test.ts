/**
 * TEMPORARY FREEZE — expires when the P1 read/write switch starts (Phase 2).
 *
 * 2026-11-05 决策：person / person_name / family / family_partner /
 * family_child / event 六表是**目标真源**，`node` 只是「当前」唯一读写源。
 * 见 docs/superpowers/plans/2026-11-05-p1-read-write-switch.md。
 *
 * 这个门禁只说一件事：闸门（谱书编目 + 排版主线端到端跑通）达成之前，
 * 不要再长大第二套人丁模型，也不要给它加第二个读者 / 写者。它不是
 * 「事实层不准被读」——那会和目标真源的决策相反。
 *
 * 过期条件的唯一真源是计划 Task 3 / Step 3：Phase 2「写切换」启动时，
 * 把下面四条临时断言连同 tests/security-regressions.test.ts 的
 * `fact-layer write boundary` 一起改写或删除——那时业务代码**应当**写事实层。
 * Phase 1 只是写路径设计，不写库、不改 UI，冻结仍然生效，别提前拆门禁。
 * 切换期间的形状由切换自己的集成测试钉住。
 * 下面 `fact-layer tenant invariants` 是跨越切换的长期约束，保留。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

const SCHEMA_DIR = 'lib/db/schema';
const FACT_FILES = [
  `${SCHEMA_DIR}/person.ts`,
  `${SCHEMA_DIR}/family.ts`,
  `${SCHEMA_DIR}/event.ts`,
];

// 物理表名，取自 pgTable() 第一个参数；不是 TS 导出符号，也不是迁移编号。
const FROZEN_TABLES = [
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
].sort();

const FACT_SYMBOLS = [
  'persons',
  'personNames',
  'families',
  'familyPartners',
  'familyChildren',
  'events',
];

// 列名快照，从 lib/db/schema/ 的列声明派生后固定在此。它是**刻意的**第二份
// 事实：列名一变就失败，逼迫改动者先看切换计划。Phase 2 启动即删除。
// 范围只到列名：`(t) => [...]` 里的索引 / 约束回调不快照（见 test 1 注释）。
const FROZEN_COLUMNS: Record<string, string> = {
  person:
    'id,orgId,projectId,sex,livingStatus,livingStatusLocked,privacyLevel,nameStatus,primaryNameId,mergedIntoId,sortKey,legacyNodeId,createdAt,createdBy,updatedAt,deletedAt',
  person_name:
    'id,orgId,projectId,personId,nameType,customType,fullName,surname,givenName,namePrefix,nameSuffix,surnamePrefix,nickname,pinyin,romanized,language,sortOrder,createdAt,createdBy,updatedAt,deletedAt',
  family:
    'id,orgId,projectId,unionType,sort,notes,createdAt,createdBy,updatedAt,deletedAt',
  family_partner:
    'id,orgId,projectId,familyId,personId,role,partnerOrder,status,createdAt,createdBy,updatedAt,deletedAt',
  family_child:
    'id,orgId,projectId,familyId,personId,parentageType,isPrimary,sort,createdAt,createdBy,updatedAt,deletedAt',
  event:
    'id,orgId,projectId,personId,familyId,eventKind,eventType,customType,gedcomTag,title,value,description,dateOriginal,dateStart,dateEnd,datePrecision,dateQualifier,calendar,dateCn,ageText,ageYears,ageBasis,placeOriginal,createdAt,createdBy,updatedAt,deletedAt',
};

/**
 * pgTable('name', { ... }, ...) 的列块；4 空格缩进是仓库统一的列声明写法。
 * `export const` 与 `const ... export { ... }` 两种写法都要认，否则一次合法的
 * 导出重构就能让下面两个 describe 静默零断言（独立评审 I2）。
 */
function tableBlocks(source: string) {
  return [
    ...source.matchAll(
      /(?:export\s+)?const (\w+) = pgTable\(\s*'([a-z_]+)',\s*\{([\s\S]*?)\n {2}\},/g
    ),
  ];
}

/** 实际解析到的物理表名；两个 describe 都用它对齐 FROZEN_TABLES，防零断言空转。 */
function parsedFactTables(): string[] {
  return FACT_FILES.flatMap((file) =>
    tableBlocks(read(file)).map((block) => block[2])
  ).sort();
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(join(root, path)).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx|mjs)$/.test(entry)
        ? [path]
        : [];
  });
}

// 这些文件本来就拥有事实层：schema 定义、回填 / 对账实现、把整个 schema
// 交给 Drizzle 的接线文件。其余 app / components / hooks / lib / data / scripts
// 一旦出现事实层 import，就是第二个读者或写者。
//
// 边界（刻意不追求完备：这是 Phase 2 就删的临时护栏，不是静态分析器）：
// 拦三类真实引用——① 静态 import 语句里的具名符号（`schema` / `db` /
// `schema/index` / `schema/<fact>` 等模块路径）；② `schema.<符号>` 属性访问；
// ③ Drizzle 的 `db.query.<符号>` / `tx.query.<符号>`——`lib/db/drizzle.ts`
// 把整个 schema 注册进 db，所以这是**不需要任何 import** 就能读到事实层的
// 最自然路径（独立评审 I1）。动态 import()、require()、别名 namespace、
// 括号取属性、re-export、`db.execute(sql\`...\`)` 里的裸表名等刻意绕过不在
// 这里拦——它们由 TypeScript strict、Biome 的 noRestrictedImports 与人工评审
// 兜底。为了防意外漂移写一套 AST / SQL parser，会让机制比它保护的东西还重。
// tests/ 也不在扫描范围：集成测试与 factories 本来就是事实层的合法读者；
// 根目录框架入口（proxy.ts 等）不含事实层逻辑。
const OWNER_PREFIXES = [
  'lib/db/schema/',
  'lib/db/backfill/',
  'lib/db/migrations/',
];
const OWNER_FILES = [
  'lib/db/drizzle.ts',
  'lib/db/auth-db.ts',
  'lib/db/auth-schema.ts',
  'lib/db/seed.ts',
];
const BUSINESS_DIRS = ['app', 'components', 'hooks', 'lib', 'data', 'scripts'];
const SCHEMA_MODULE =
  /(?:\/|^)(?:schema|db)(?:\/(?:index|person|family|event))?$|^\.{1,2}\/(?:person|family|event|schema)$/;
const IMPORT_STATEMENT = /^import[^;]*?from\s*['"]([^'"]+)['"]/gm;
const FACT_ACCESS =
  /\b(?:schema|db|tx)\.(?:query\.)?(?:persons|personNames|families|familyPartners|familyChildren|events)\b/;

describe('fact-layer freeze (TEMPORARY — rewrite/delete at Phase 2)', () => {
  test('the six fact-layer tables are still the only ones', () => {
    // 从全部 schema 文件派生，而不是只读三个已知文件。范围是按物理表名前缀
    // 识别这六张事实层表；另起名字的新表不在本断言范围（独立评审 I3），由
    // 计划 Global Constraints 与 AGENTS.md 的迁移人工 review 兜底——不为了
    // 覆盖它去维护一份全库表清单，那是比这份临时护栏更重、且会失真的第二份事实。
    const declared = readdirSync(join(root, SCHEMA_DIR))
      .filter((file) => file.endsWith('.ts'))
      .flatMap((file) =>
        [...read(`${SCHEMA_DIR}/${file}`).matchAll(/pgTable\(\s*'([a-z_]+)'/g)]
          .map((match) => match[1])
          .filter((name) => /^(?:person|family|event)/.test(name))
      )
      .sort();
    expect(declared).toEqual(FROZEN_TABLES);
  });

  test('the frozen tables keep their column shape', () => {
    for (const file of FACT_FILES) {
      const blocks = tableBlocks(read(file));
      expect(blocks.length, file).toBeGreaterThan(0);
      for (const block of blocks) {
        const [, , table, body] = block;
        const columns = [...body.matchAll(/^ {4}(\w+): /gm)]
          .map((match) => match[1])
          .join(',');
        expect(columns, `${file} ${table}`).toBe(FROZEN_COLUMNS[table]);
      }
    }
    // 两处对齐：硬编码常量没漏表，且 schema 里真的解析出了这六张表——
    // 否则一次导出重构（或 pgTable 声明改名）会让上面两个 describe 静默零断言。
    expect(parsedFactTables()).toEqual(FROZEN_TABLES);
    expect(Object.keys(FROZEN_COLUMNS).sort()).toEqual(FROZEN_TABLES);
  });

  test('business code has no fact-layer import', () => {
    const offenders: string[] = [];
    for (const dir of BUSINESS_DIRS) {
      for (const file of sourceFiles(dir)) {
        if (OWNER_PREFIXES.some((prefix) => file.startsWith(prefix))) continue;
        if (OWNER_FILES.includes(file)) continue;
        const source = read(file);
        for (const match of source.matchAll(IMPORT_STATEMENT)) {
          if (!SCHEMA_MODULE.test(match[1])) continue;
          for (const symbol of FACT_SYMBOLS) {
            if (new RegExp(`\\b${symbol}\\b`).test(match[0])) {
              offenders.push(`${file}: imports ${symbol} from ${match[1]}`);
            }
          }
        }
        if (FACT_ACCESS.test(source)) {
          offenders.push(
            `${file}: reaches a fact table through schema/db/tx access`
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('no migration after the freeze baseline touches the fact layer', () => {
    const journal = JSON.parse(
      read('lib/db/migrations/meta/_journal.json')
    ) as { entries: { idx: number; tag: string }[] };
    const baseline = journal.entries.find(
      (entry) => entry.tag === '0027_yummy_captain_cross'
    );
    expect(
      baseline,
      'freeze baseline 0027 must stay in the journal'
    ).toBeDefined();

    // Floor, not equality: 无关的普通迁移可以自由增加，只有事实层 DDL 会被拦。
    // 基线之后当前没有迁移，offenders 为空是**预期**结果；新增 idx>27 的迁移
    // 会被逐行扫描。按行匹配 drizzle 生成的单行 DDL 已足够——跨行手写 SQL、
    // CREATE TRIGGER、字符串字面量里的表名、纯 SQL 新事实表都不在范围内，
    // 由 AGENTS.md 要求的「迁移人工 review」兜底。不把护栏升级成 SQL parser，
    // 也不假装它覆盖了这些形态。
    const factDdl =
      /\b(?:ALTER|CREATE|DROP|TRUNCATE|COMMENT|GRANT|REVOKE)\b[^\n;]*?\b(?:person|person_name|family|family_partner|family_child|event)\b/i;
    const offenders: string[] = [];
    for (const entry of journal.entries.filter(
      (item) => item.idx > (baseline?.idx ?? 27)
    )) {
      const sql = read(`lib/db/migrations/${entry.tag}.sql`);
      for (const line of sql.split('\n')) {
        if (factDdl.test(line)) offenders.push(`${entry.tag}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('fact-layer tenant invariants (permanent)', () => {
  test('every fact-layer table carries tenant columns and soft delete', () => {
    // 四条临时断言在 Phase 2 删除后，这里是唯一剩下的结构门禁；两重防零断言：
    // 解析到的表集合必须恰好是六张，再逐表查租户列与软删列。
    expect(parsedFactTables()).toEqual(FROZEN_TABLES);
    for (const file of FACT_FILES) {
      const blocks = tableBlocks(read(file));
      expect(blocks.length, file).toBeGreaterThan(0);
      for (const block of blocks) {
        const [, , table, body] = block;
        expect(body, `${file} ${table}`).toContain(
          "uuid('organization_id').notNull()"
        );
        expect(body, `${file} ${table}`).toContain(
          "uuid('project_id').notNull()"
        );
        expect(body, `${file} ${table}`).toContain("timestamptz('deleted_at')");
      }
    }
  });
});
