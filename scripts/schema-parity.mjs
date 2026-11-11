/**
 * T39 parity 的可离线执行者。
 *
 * `scripts/verify-target-schema.mjs` 顶层无条件调 `main()`（会 DROP DATABASE），
 * 所以它的 `verifyParity()` 不能被单测直接 import。把「期望集 ↔ catalog」的纯
 * 差集计算拆到这里：脚本负责查 pg_catalog，模块负责判定，单测只喂假快照与假
 * 查询结果，不需要连库。
 *
 * 只看 `public.*`：`auth.*` 四表按规格决议 ② 由 Better Auth 管理 DDL，仓内仅 TS
 * 镜像，沿用 verify-target-schema.mjs 的既有排除口径。
 */

const PUBLIC_PREFIX = 'public.';
const CONTENT_PK_COLUMNS = ['project_id', 'id'];
const GLOBAL_ID_COLUMNS = ['id'];

function sameColumns(left, right) {
  return (
    Array.isArray(left) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/** @returns {{ table: string, value: Record<string, any> }[]} */
function publicTables(snapshot) {
  return Object.entries(snapshot.tables ?? {})
    .filter(([key]) => key.startsWith(PUBLIC_PREFIX))
    .map(([key, value]) => ({
      table: key.slice(PUBLIC_PREFIX.length),
      value: /** @type {Record<string, any>} */ (value),
    }));
}

/**
 * 13 张 `(project_id, id)` 内容表必须各有一条 `UNIQUE (id)`：复合主键挡不住
 * 同一个 id 跨项目复用，而查询层按单列 join 寻址。返回缺该约束的表名。
 *
 * @param {{ tables: Record<string, any> }} snapshot
 * @param {{ table: string, name: string, columns: string[] }[]} dbUnique
 * @returns {string[]}
 */
export function globalUniqueIssues(snapshot, dbUnique) {
  const issues = [];
  for (const { table, value } of publicTables(snapshot)) {
    const isContentTable = Object.values(value.compositePrimaryKeys ?? {}).some(
      (pk) => sameColumns(pk.columns, CONTENT_PK_COLUMNS)
    );
    if (!isContentTable) {
      continue;
    }
    const hasGlobalId = dbUnique.some(
      (entry) =>
        entry.table === table && sameColumns(entry.columns, GLOBAL_ID_COLUMNS)
    );
    if (!hasGlobalId) {
      issues.push(table);
    }
  }
  return issues;
}

/**
 * TS 快照声明的索引必须在真实库里存在。反向（库有 TS 无）不报：基线里的内联
 * 无名索引与 TS 具名索引天然对不上名，逐名双向比对只会制造假红。返回 TS 有而
 * 库没有的索引名。
 *
 * @param {{ tables: Record<string, any> }} snapshot
 * @param {{ table: string, name: string }[]} dbIndexes
 * @returns {string[]}
 */
export function indexParityIssues(snapshot, dbIndexes) {
  const present = new Set(
    dbIndexes.map((entry) => `${entry.table}.${entry.name}`)
  );
  const issues = [];
  for (const { table, value } of publicTables(snapshot)) {
    for (const name of Object.keys(value.indexes ?? {})) {
      if (!present.has(`${table}.${name}`)) {
        issues.push(name);
      }
    }
  }
  return issues;
}
