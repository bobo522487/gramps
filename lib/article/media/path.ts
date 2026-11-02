import { MEDIA_PATH_ROOT } from '@/lib/article/constants';

/**
 * Media pathnames are the only identifier a document stores for an image
 * (ADR 0019): `articles/<organizationId>/<articleId>/<uuid>.<ext>`. Shape is
 * validated here so every channel — read proxy, fs upload, Blob token
 * issuance — applies the exact same rule.
 */
export type MediaPathnameParts = {
  orgId: string;
  articleId: string;
  filename: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No `..`, no slashes, no leading dot: everything else is rejected. */
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function toParts(segments: string[]): MediaPathnameParts | null {
  if (segments.length !== 4) {
    return null;
  }
  const [root, orgId, articleId, filename] = segments;
  if (root !== MEDIA_PATH_ROOT) {
    return null;
  }
  if (!orgId || !UUID_RE.test(orgId)) {
    return null;
  }
  if (!articleId || !UUID_RE.test(articleId)) {
    return null;
  }
  if (!filename || !FILENAME_RE.test(filename)) {
    return null;
  }
  return { orgId, articleId, filename };
}

/** Accepts a joined pathname or the `key` segments Next gives a catch-all route. */
export function parseMediaPathname(
  input: string | string[]
): MediaPathnameParts | null {
  const segments = Array.isArray(input) ? input : input.split('/');
  return toParts(
    segments.map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
  );
}

export function buildMediaPathname(
  orgId: string,
  articleId: string,
  filename: string
): string {
  return `${MEDIA_PATH_ROOT}/${orgId}/${articleId}/${filename}`;
}

export function mediaFilenameFor(uuid: string, contentType: string): string {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType] ?? 'bin';
  return `${uuid}.${extension}`;
}

export function contentTypeForMediaPathname(pathname: string): string {
  const extension = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * The declared MIME type is a client claim; the magic bytes decide. Only the
 * three formats the spec allows (FR-025) are recognized.
 */
export function sniffImageContentType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0
    ) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function startsWith(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

/**
 * 图片在页面里的地址：一律走服务端代理，浏览器拿不到存储直链。
 *
 * 每一段都单独编码，这样 `..%2F` 之类的写法到不了 `parseMediaPathname`。
 * 授权也在这条路上做（`app/api/media/[...key]/route.ts`），
 * 所以这个 URL 可以安全地出现在文档渲染里（FR-034、ADR 0019）。
 */
export function mediaUrl(pathname: string): string {
  const encoded = pathname
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/media/${encoded}`;
}
