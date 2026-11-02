import 'server-only';

import { BlobNotFoundError, del, get } from '@vercel/blob';
import { contentTypeForMediaPathname } from './path';
import { presignPrivateRead } from './read-url';
import type { MediaObject, MediaStore } from './store';
import { blobReadWriteToken } from './token';

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

  async readRedirect(pathname): Promise<string | null> {
    return presignPrivateRead(pathname);
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
