import { describe, expect, test } from 'vitest';
import {
  SCRAM_ITERATIONS,
  scramSha256,
} from '../scripts/lib/scram-verifier.mjs';

/**
 * SCRAM-SHA-256 verifier 必须**算得对**，否则 `ALTER ROLE … PASSWORD 'SCRAM-…'`
 * 会写进一个服务端拒收的串，应用侧连接全线 28P01——而且只在运行时暴露。
 * 因此不只用正则校验格式，还用 RFC 7677 的官方测试向量逐字节比对。
 */
describe('SCRAM-SHA-256 verifier', () => {
  test('RFC 7677 §2.1 的官方测试向量', () => {
    // user="user", pass="pencil", salt="W22ZaJ0SNY7soEsUEjb6gQ==",
    // 迭代 4096。StoredKey / ServerKey 取自 RFC 7677 附录 A 的示例。
    const verifier = scramSha256(
      'pencil',
      Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64')
    );
    expect(verifier).toBe(
      'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$' +
        'WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=' +
        ':' +
        'wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU='
    );
  });

  test('迭代次数与 PostgreSQL 默认一致（4096）', () => {
    expect(SCRAM_ITERATIONS).toBe(4096);
  });

  test('格式：$ 分隔的四段，salt 16 字节、两个 key 各 32 字节', () => {
    const verifier = scramSha256('pencil', Buffer.alloc(16, 1));
    const [scheme, params, keys] = verifier.split('$');
    expect(scheme).toBe('SCRAM-SHA-256');
    const [iterations, saltB64] = params.split(':');
    expect(Number(iterations)).toBe(SCRAM_ITERATIONS);
    expect(Buffer.from(saltB64, 'base64')).toHaveLength(16);

    const [storedB64, serverB64] = keys.split(':');
    expect(Buffer.from(storedB64, 'base64')).toHaveLength(32);
    expect(Buffer.from(serverB64, 'base64')).toHaveLength(32);
  });

  test('缺省 salt 随机：同一口令两次结果不同', () => {
    expect(scramSha256('pw')).not.toBe(scramSha256('pw'));
  });

  test('verifier 里不出现明文，也不含 SQL 需要转义的字符', () => {
    const verifier = scramSha256('p@ss\'wörd"\\;');
    expect(verifier).not.toContain('p@ss');
    expect(verifier).not.toContain("'");
    expect(verifier).not.toContain('"');
    expect(verifier).not.toContain('\\');
    // base64 字母表 + $ : = 足够，不需要额外转义。
    expect(verifier).toMatch(
      /^SCRAM-SHA-256\$[0-9]+:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/
    );
  });

  test('空口令与含 Unicode 的口令也能算出 verifier（不抛异常）', () => {
    expect(scramSha256('')).toMatch(/^SCRAM-SHA-256\$/);
    expect(scramSha256('口令-密码')).toMatch(/^SCRAM-SHA-256\$/);
  });
});
