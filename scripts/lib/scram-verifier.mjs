/**
 * 客户端生成 PostgreSQL 的 SCRAM-SHA-256 verifier。
 *
 * 为什么不再把明文口令塞进 SQL：`ALTER ROLE … PASSWORD '<明文>'` 的语句文本
 * 会落到托管库的查询历史、`log_statement=all` 的日志、以及慢查询记录里，而
 * PostgreSQL 对预哈希串是**接受**的（`CREATE/ALTER ROLE … PASSWORD` 接受
 * `md5…` 或 `SCRAM-SHA-256$…` 格式，服务端原样存进 `pg_authid.rolpassword`）。
 * 于是口令明文不必出进程：客户端按 RFC 5802 / RFC 7677 算出 verifier，
 * SQL 里只出现 base64 的 salt 与派生密钥。
 *
 * 格式：`SCRAM-SHA-256$<iterations>:<salt_b64>$<StoredKey_b64>:<ServerKey_b64>`
 * - SaltedPassword = PBKDF2-HMAC-SHA256(password, salt, iterations)
 * - ClientKey = HMAC-SHA256(SaltedPassword, "Client Key")
 * - StoredKey  = SHA256(ClientKey)
 * - ServerKey  = HMAC-SHA256(SaltedPassword, "Server Key")
 *
 * 兼容性：`SCRAM-SHA-256` 在 PostgreSQL ≥ 10 接受，本仓库 CI 用
 * `postgres:18-alpine`、生产 Neon（≥ 14），均支持。因此不需要保留明文回退路径。
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** 迭代次数：与 PostgreSQL 默认 4096 一致，不自行抬升。 */
export const SCRAM_ITERATIONS = 4096;

/** salt 长度：16 字节随机值，RFC 7677 的示例就是这个量级。 */
const SALT_BYTES = 16;

/**
 * @param password 明文字符串（PG 按 UTF-8 处理；ASCII 之外的字节直接以 UTF-8 编码）
 * @param salt     可选的 Buffer，用于可复现的测试；不传则随机生成
 */
export function scramSha256(password, salt = randomBytes(SALT_BYTES)) {
  const salted = pbkdf2Sync(
    Buffer.from(password, 'utf8'),
    salt,
    SCRAM_ITERATIONS,
    32,
    'sha256'
  );
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${SCRAM_ITERATIONS}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
