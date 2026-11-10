/**
 * Size/shape guard for the media upload route. Extracted from
 * `app/api/media/upload/route.ts` so it can be unit-tested in isolation and so
 * the over-limit check runs *before* `file.arrayBuffer()` copies the whole
 * payload into memory (the route's byte read happens only after this passes).
 *
 * Checks shape and size only — content-type is validated later by magic-byte
 * sniffing, never here.
 */
export type UploadGuardResult =
  | { ok: true; file: File }
  | { ok: false; error: string; status: number };

export function checkUploadLimits(
  file: unknown,
  maxBytes: number
): UploadGuardResult {
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'missing_file', status: 400 };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'image_too_large', status: 413 };
  }
  return { ok: true, file };
}
