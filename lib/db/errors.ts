import type { ActionErrorCode } from '@/lib/errors';

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

/** Action 层对外的兜底文案：SQL 细节绝不透出到浏览器。 */
export const FALLBACK_MESSAGE = '操作失败，请稍后重试。';
export const CONFLICT_MESSAGE = '数据冲突，请刷新后重试。';
export const PERMISSION_MESSAGE = '你没有执行该操作的权限。';
export const LAST_OWNER_MESSAGE = '不能移除或降级最后一个所有者。';
export const ORG_ARCHIVED_MESSAGE = '组织已归档，无法继续操作。';

/**
 * SECURITY DEFINER 函数只用 4 个 SQLSTATE 表达业务失败；这里是唯一映射表。
 * 键必须逐字对齐 `lib/db/migrations/0000_target_schema.sql` 里实际抛出的码，
 * 基线里没有任何自定义 SQLSTATE，不要再按语义名去找错误。
 */
export const PG_ERROR_MAP: Record<
  string,
  { code: ActionErrorCode; message: string }
> = {
  '42501': { code: 'FORBIDDEN', message: PERMISSION_MESSAGE },
  '22023': { code: 'CONFLICT', message: CONFLICT_MESSAGE },
  '23505': { code: 'CONFLICT', message: CONFLICT_MESSAGE },
  '23001': { code: 'CONFLICT', message: CONFLICT_MESSAGE },
};

/**
 * 同一个 SQLSTATE 承载多种业务语义，靠驱动消息里的关键词细分文案。
 * 消息判断只放在这里，调用方不再各自拼一串 sqlStateOf 分支。
 */
const MESSAGE_OVERRIDES: ReadonlyArray<{
  sqlState: string;
  needles: readonly string[];
  message: string;
}> = [
  {
    sqlState: '22023',
    needles: ['不能移除最后一个所有者'],
    message: LAST_OWNER_MESSAGE,
  },
  {
    sqlState: '22023',
    needles: ['组织已归档'],
    message: ORG_ARCHIVED_MESSAGE,
  },
  {
    sqlState: '22023',
    needles: ['邀请无效或已过期'],
    message: '邀请无效或已过期，请让管理员重新邀请',
  },
  {
    sqlState: '42501',
    needles: ['邀请邮箱与当前账号不匹配', '未认证'],
    message: '该邀请不是发给当前账号的',
  },
  {
    sqlState: '23505',
    needles: ['当前账号已是该组织成员'],
    message: '当前账号已是该组织成员',
  },
];

/**
 * 把错误链里第一个已知 SQLSTATE 转成 Action 错误码 + 中文文案。
 * 未命中返回 null，让调用方继续走 Better Auth / HTTP status 兜底。
 */
export function pgErrorOf(
  error: unknown
): { code: ActionErrorCode; message: string } | null {
  for (const value of errorChain(error)) {
    const base =
      typeof value.code === 'string' ? PG_ERROR_MAP[value.code] : undefined;
    if (!base) {
      continue;
    }
    const message = typeof value.message === 'string' ? value.message : '';
    const override = MESSAGE_OVERRIDES.find(
      (entry) =>
        entry.sqlState === value.code &&
        entry.needles.some((needle) => message.includes(needle))
    );
    return { code: base.code, message: override?.message ?? base.message };
  }
  return null;
}
