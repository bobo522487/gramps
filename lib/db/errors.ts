type PgError = { code?: string; message?: string };

function pgError(error: unknown): PgError | null {
  return typeof error === 'object' && error !== null
    ? (error as PgError)
    : null;
}

/** PostgreSQL SQLSTATE 23505 (unique_violation). */
export function isUniqueViolation(error: unknown): boolean {
  return pgError(error)?.code === '23505';
}

/**
 * Matches exceptions raised by our SECURITY DEFINER functions, e.g.
 * `RAISE EXCEPTION 'invalid_invitation'` (SQLSTATE P0001).
 */
export function isRaisedException(error: unknown, name: string): boolean {
  const value = pgError(error);
  return (
    value?.code === 'P0001' &&
    typeof value.message === 'string' &&
    value.message.includes(name)
  );
}
