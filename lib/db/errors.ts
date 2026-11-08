type PgError = { code?: string; message?: string; constraint?: string };

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
 * PostgreSQL SQLSTATE 23503 (foreign_key_violation). Target state has no soft
 * delete and every project-internal FK is RESTRICT, so a delete that still has
 * children fails here instead of silently marking a row.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return errorChain(error).some((value) => value.code === '23503');
}

/**
 * 23503 但只看某几条约束名。删除类操作必须用它而不是上面的宽匹配：
 * 一个 `DELETE` 上挂了多种 FK，其中只有一部分代表「还有内容，不能删」，
 * 其余（比如历史遗留的 ON DELETE SET NULL 之外的可空引用）是真正的故障，
 * 宽匹配会把故障伪装成业务提示，用户照着提示清空内容也删不掉。
 *
 * PostgreSQL 在错误报文里带 `constraint`（约束名，不是列名），所以这里按
 * 约束名精确比对，不做前缀 / 模糊匹配。
 */
export function isForeignKeyViolationOf(
  error: unknown,
  constraints: readonly string[]
): boolean {
  const names = new Set(constraints);
  return errorChain(error).some(
    (value) =>
      value.code === '23503' &&
      typeof value.constraint === 'string' &&
      names.has(value.constraint)
  );
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

/** 从错误链里取出 23503 的约束名，供日志与兜底文案使用。 */
export function foreignKeyConstraintOf(error: unknown): string | null {
  for (const value of errorChain(error)) {
    if (value.code === '23503' && typeof value.constraint === 'string') {
      return value.constraint;
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
