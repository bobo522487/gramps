import 'server-only';

import { getMediaMode, type MediaMode } from '@/lib/config';
import { blobMediaStore } from './blob-store';
import { fsMediaStore } from './fs-store';

/** Bytes plus the type to serve them as. `null` from a store means "not there". */
export type MediaObject = {
  /** `Uint8Array<ArrayBuffer>` so it can become a `BlobPart` without a copy. */
  bytes: Uint8Array<ArrayBuffer>;
  contentType: string;
};

/**
 * The one seam between storage backends (ADR 0019). Everything above it —
 * document validation, the read proxy, page deletion — is backend agnostic.
 */
export interface MediaStore {
  readonly mode: MediaMode;
  read(pathname: string): Promise<MediaObject | null>;
  delete(pathname: string): Promise<void>;
}

/** Chosen in exactly one place: `BLOB_READ_WRITE_TOKEN` on Vercel, else the filesystem. */
export function getMediaStore(): MediaStore {
  return getMediaMode() === 'blob' ? blobMediaStore : fsMediaStore;
}
