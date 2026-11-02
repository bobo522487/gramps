import 'server-only';

import { getServerConfig } from '@/lib/config';

/**
 * Read-write token, read through `lib/config.ts` only (F7). Kept in its own
 * module so the store drivers and the signed-URL helper can both use it without
 * importing each other.
 */
export function blobReadWriteToken(): string {
  const token = getServerConfig().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN 未配置，无法访问 Vercel Blob');
  }
  return token;
}
