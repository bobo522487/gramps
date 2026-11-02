import 'server-only';

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { contentTypeForMediaPathname } from './path';
import type { MediaObject, MediaStore } from './store';

/**
 * Local fallback driver (ADR 0019): Vercel Blob needs a read-write token that
 * neither a fresh clone nor CI has, and images must be exercisable without a
 * cloud account. Never enabled on Vercel — `getMediaMode()` only returns 'fs'
 * there when the token is missing, which means misconfiguration.
 */
const MEDIA_ROOT = path.resolve(process.cwd(), '.data', 'media');

function resolveInsideRoot(pathname: string): string {
  const normalized = path.normalize(pathname);
  if (
    path.isAbsolute(normalized) ||
    normalized.startsWith(`..${path.sep}`) ||
    normalized === '..'
  ) {
    throw new Error(`媒体路径越出根目录：${pathname}`);
  }
  const full = path.resolve(MEDIA_ROOT, normalized);
  if (full !== MEDIA_ROOT && !full.startsWith(MEDIA_ROOT + path.sep)) {
    throw new Error(`媒体路径越出根目录：${pathname}`);
  }
  return full;
}

export const fsMediaStore: MediaStore & {
  put(pathname: string, bytes: Uint8Array, contentType: string): Promise<void>;
  cleanup(): Promise<void>;
} = {
  mode: 'fs',

  // `contentType` keeps the call site symmetric with the Blob driver; on disk
  // the type is derived from the extension, which we control at write time.
  async put(pathname, bytes, _contentType): Promise<void> {
    const target = resolveInsideRoot(pathname);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  },

  async read(pathname): Promise<MediaObject | null> {
    const target = resolveInsideRoot(pathname);
    try {
      const file = await readFile(target);
      const bytes = new Uint8Array(file.byteLength);
      bytes.set(file);
      return {
        bytes,
        contentType: contentTypeForMediaPathname(pathname),
      };
    } catch (error) {
      if (isMissingFile(error)) {
        return null;
      }
      throw error;
    }
  },

  // 本地兜底驱动没有可直连的域名，字节由读取路由自己发。
  async readRedirect(): Promise<string | null> {
    return null;
  },

  async delete(pathname): Promise<void> {
    const target = resolveInsideRoot(pathname);
    await rm(target, { force: true });
  },

  /** Test helper: wipes the whole local media directory. */
  async cleanup(): Promise<void> {
    await rm(MEDIA_ROOT, { recursive: true, force: true });
  },
};

export function fsMediaRoot(): string {
  return MEDIA_ROOT;
}

export async function fsMediaExists(pathname: string): Promise<boolean> {
  try {
    return (await stat(resolveInsideRoot(pathname))).isFile();
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function isMissingFile(error: unknown): boolean {
  return hasErrorCode(error, 'ENOENT');
}

function hasErrorCode(error: unknown, expected: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String(error.code) === expected
  );
}
