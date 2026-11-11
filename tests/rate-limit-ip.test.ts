import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders } from '@/lib/auth/rate-limit';

describe('clientIpFromHeaders', () => {
  it('优先使用 x-real-ip', () => {
    expect(clientIpFromHeaders('203.0.113.7', '198.51.100.1, 10.0.0.1')).toBe(
      '203.0.113.7'
    );
  });

  it('追加型代理下取最后一个 hop，忽略客户端伪造的最左值', () => {
    expect(clientIpFromHeaders(null, '1.2.3.4, 203.0.113.7')).toBe(
      '203.0.113.7'
    );
  });

  it('平台已覆盖为单值时直接使用', () => {
    expect(clientIpFromHeaders(null, '203.0.113.7')).toBe('203.0.113.7');
  });

  it('两个头都缺失时返回 unknown', () => {
    expect(clientIpFromHeaders(null, null)).toBe('unknown');
    expect(clientIpFromHeaders('  ', ' , ')).toBe('unknown');
  });
});
