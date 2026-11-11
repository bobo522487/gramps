type PgError = {
  code?: string;
  message?: string;
  /** node-postgres 把约束名放在 `constraint` 上，SQLSTATE 在 `code` 上。 */
  constraint?: string;
};

/**
 * FK 违约有两种 SQLSTATE：`23503` (foreign_key_violation，插入时引用不存在 /
 * NO ACTION 删除) 与 `23001` (restrict_violation，ON DELETE RESTRICT 命中)。
 * 目标态基线里 project 的 13 条子表外键全是 RESTRICT，删除项目只会拿到
 * `23001`；只认 `23503` 会让 not_empty 分支永远走不到（PG18 实测）。
 */
const FK_VIOLATION_CODES = new Set(['23503', '23001']);

function isFkViolation(value: PgError): boolean {
  return typeof value.code === 'string' && FK_VIOLATION_CODES.has(value.code);
}

function constraintName(value: PgError): string | null {
  const name = value.constraint;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

/**
 * Drizzle wraps driver failures and Better Auth may wrap those again, so the
 * PostgreSQL SQLSTATE can live several `cause` / `body.cause` hops away.
 */
function errorChain(error: unknown, maxDepth = 8): PgError[] {
  const chain: PgError[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) {
      break;
    }
    seen.add(current);
    chain.push(current as PgError);

    const value = current as {
      cause?: unknown;
      body?: { cause?: unknown };
    };
    if (value.body?.cause !== undefined) {
      current = value.body.cause;
    } else if (value.cause !== undefined) {
      current = value.cause;
    } else {
      break;
    }
  }

  return chain;
}

/** PostgreSQL SQLSTATE 23505 (unique_violation). */
export function isUniqueViolation(error: unknown): boolean {
  return errorChain(error).some((value) => value.code === '23505');
}

/**
 * `23503` 或 `23001`。目标态没有软删，project 内每条 FK 都是 RESTRICT，
 * 有子行时删除在这里失败而不是静默标记。
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorChain(error).some(isFkViolation);
}

/**
 * FK 违约但只看某几条约束名。删除类操作必须用它而不是上面的宽匹配：
 * 一个 `DELETE` 上挂了多种 FK，其中只有一部分代表「还有内容，不能删」，
 * 其余（比如历史遗留的 ON DELETE SET NULL 之外的可空引用）是真正的故障，
 * 宽匹配会把故障伪装成业务提示，用户照着提示清空内容也删不掉。
 *
 * PostgreSQL 在错误报文里带约束名（不是列名），所以这里按约束名精确比对，
 * 不做前缀 / 模糊匹配。node-postgres 把它放在 `constraint` 上；RESTRICT
 * 命中时报 `23001`，插入类外键违约报 `23503`。
 */
export function isForeignKeyViolationOf(
  error: unknown,
  constraints: readonly string[]
): boolean {
  const names = new Set(constraints);
  return errorChain(error).some((value) => {
    const name = constraintName(value);
    return isFkViolation(value) && name !== null && names.has(name);
  });
}

/**
 * 从错误链里取出**某个** SQLSTATE，没命中返回 null。
 *
 * 存在的理由：调用方拿到的往往不是 `PostgresError` 本身。Drizzle 会把驱动
 * 异常包成 `DrizzleQueryError`（`new DrizzleQueryError(query, params, cause)`
 * ——SQLSTATE 只在 `cause` 上，顶层没有 `code`），Better Auth 可能再包一层。
 * 直接读 `error.code` 会一律拿到 `undefined`，所有按 SQLSTATE 分支的映射
 * 都会静默退化成兜底文案。
 */
export function sqlStateOf(error: unknown, sqlState: string): boolean {
  return errorChain(error).some((value) => value.code === sqlState);
}

/** 从错误链里取出 `23503` / `23001` 的约束名，供日志与兜底文案使用。 */
export function foreignKeyConstraintOf(error: unknown): string | null {
  return constraintOf(error, FK_VIOLATION_CODES);
}

/**
 * 取错误链里某个 SQLSTATE（或一组）的约束名。唯一冲突与 FK 违约共用；
 * 单看 `error.constraint` 不够，Drizzle / Better Auth 会把驱动异常包进
 * `cause`，所以必须走完整条链。
 */
export function constraintOf(
  error: unknown,
  sqlState: string | ReadonlySet<string>
): string | null {
  const states = typeof sqlState === 'string' ? new Set([sqlState]) : sqlState;
  for (const value of errorChain(error)) {
    if (typeof value.code === 'string' && states.has(value.code)) {
      const name = constraintName(value);
      if (name) {
        return name;
      }
    }
  }
  return null;
}

/**
 * Matches exceptions raised by our SECURITY DEFINER functions, e.g.
 * `RAISE EXCEPTION 'invalid_invitation'` (SQLSTATE P0001).
 */
export function isRaisedException(error: unknown, name: string): boolean {
  return errorChain(error).some(
    (value) =>
      value.code === 'P0001' &&
      typeof value.message === 'string' &&
      value.message.includes(name)
  );
}
