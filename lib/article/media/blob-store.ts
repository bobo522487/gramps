import 'server-only';

import { BlobNotFoundError, del, get } from '@vercel/blob';

import { getServerConfig } from '@/lib/config';
import { contentTypeForMediaPathname } from './path';
import type { MediaObject, MediaStore } from './store';

/** Read-write token, read through `lib/config.ts` only (F7). */
export function blobReadWriteToken(): string {
  const token = getServerConfig().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('BLOB_READ_WRITE_TOKEN 未配置，无法访问 Vercel Blob');
  }
  return token;
}

export const blobMediaStore: MediaStore = {
  mode: 'blob',

  async read(pathname): Promise<MediaObject | null> {
    try {
      const result = await get(pathname, {
        access: 'private',
        token: blobReadWriteToken(),
      });
      if (result?.statusCode !== 200) {
        return null;
      }
      const bytes = new Uint8Array(
        await new Response(result.stream).arrayBuffer()
      );
      return {
        bytes,
        contentType:
          result.blob.contentType || contentTypeForMediaPathname(pathname),
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  },

  async delete(pathname): Promise<void> {
    try {
      await del(pathname, { token: blobReadWriteToken() });
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return;
      }
      throw error;
    }
  },
};
