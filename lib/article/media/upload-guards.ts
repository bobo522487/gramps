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

/** multipart 边界、字段头等额外字节的余量。 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * 在 `request.formData()` 把整个请求体缓冲进内存之前，用声明的
 * Content-Length 先挡一刀。chunked 请求没有该头，这里只能挡住诚实客户端；
 * 真正的兜底仍是部署层的 body 上限。
 */
export function declaredBodyTooLarge(
  contentLength: string | null,
  maxBytes: number
): boolean {
  if (!contentLength) {
    return false;
  }
  const declared = Number(contentLength);
  return (
    Number.isFinite(declared) && declared > maxBytes + MULTIPART_OVERHEAD_BYTES
  );
}

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
