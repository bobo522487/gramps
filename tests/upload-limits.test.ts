import { describe, expect, it } from 'vitest';
import {
  checkUploadLimits,
  declaredBodyTooLarge,
} from '@/lib/article/media/upload-guards';

const MAX = 10 * 1024 * 1024;

describe('checkUploadLimits', () => {
  it('空文件或非 File 直接 400，不读字节', () => {
    expect(checkUploadLimits(null, MAX)).toEqual({
      ok: false,
      error: 'missing_file',
      status: 400,
    });
    const empty = new File([new Uint8Array(0)], 'x.png', {
      type: 'image/png',
    });
    expect(checkUploadLimits(empty, MAX)).toEqual({
      ok: false,
      error: 'missing_file',
      status: 400,
    });
  });

  it('超过上限时 413，且只看 size 不碰 arrayBuffer', () => {
    // 关键行为：尺寸判定必须发生在读取字节之前，否则会在请求处理器里先复制
    // 一整份 10MB+ 的缓冲区。这里用一个 arrayBuffer 必抛的假 File 证明——
    // 走到 size 判定就返回，根本不会调用它。
    const oversize = Object.create(File.prototype) as File;
    Object.defineProperties(oversize, {
      size: { value: MAX + 1 },
      arrayBuffer: {
        value: () => {
          throw new Error('arrayBuffer must not be called');
        },
      },
    });

    const result = checkUploadLimits(oversize, MAX);
    expect(result).toEqual({
      ok: false,
      error: 'image_too_large',
      status: 413,
    });
  });

  it('合法文件返回 ok，并带回已校验的 File', () => {
    const valid = new File([new Uint8Array(8)], 'x.png', {
      type: 'image/png',
    });
    const result = checkUploadLimits(valid, MAX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.file).toBeInstanceOf(File);
    }
  });
});

describe('declaredBodyTooLarge', () => {
  it('没有 Content-Length 时不拦截（chunked 请求）', () => {
    expect(declaredBodyTooLarge(null, MAX)).toBe(false);
    expect(declaredBodyTooLarge('', MAX)).toBe(false);
  });

  it('声明长度超过上限加 multipart 余量时拦截', () => {
    expect(declaredBodyTooLarge(String(MAX + 1), MAX)).toBe(false);
    expect(declaredBodyTooLarge(String(MAX + 1024 * 1024), MAX)).toBe(true);
  });

  it('非法 Content-Length 不拦截', () => {
    expect(declaredBodyTooLarge('not-a-number', MAX)).toBe(false);
  });
});
