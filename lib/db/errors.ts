type PgError = { code?: string; message?: string };

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
