import { afterAll, beforeAll } from 'vitest';

/**
 * 把这一份测试文件钉在 `.data/media/` 兜底驱动上。
 *
 * 媒体驱动只看 `BLOB_READ_WRITE_TOKEN` 有没有配（`lib/config.ts`），而有些测试
 * 断言的是本地落盘的文件（例如删页后独占字节要消失）。开发机 `.env` 里配了真令牌
 * 时，同一份断言会打到真实私有桶上、看起来像回归。这里临时摘掉令牌，跑完还原。
 * 真实 Blob 路径由 `tests/integration/media-blob.test.ts` 覆盖（无令牌时整体 skip）。
 */
export function pinFsMediaMode(): void {
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
  });
  afterAll(() => {
    if (saved !== undefined) {
      process.env.BLOB_READ_WRITE_TOKEN = saved;
    }
  });
}
