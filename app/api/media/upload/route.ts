import { withApiLogging } from '@/lib/api';
import {
  ARTICLE_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
} from '@/lib/article/constants';
import { fsMediaStore } from '@/lib/article/media/fs-store';
import {
  buildMediaPathname,
  mediaFilenameFor,
  parseMediaPathname,
  sniffImageContentType,
} from '@/lib/article/media/path';
import { checkUploadLimits } from '@/lib/article/media/upload-guards';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgRole, hasPermission } from '@/lib/auth/permissions';
import { getMediaMode } from '@/lib/config';
import { getArticleScope } from '@/lib/db/queries/articles';

/**
 * Upload channel for the local filesystem driver only; on Vercel the client
 * uploads straight to Blob through `/api/blob/upload` instead (ADR 0019), so
 * this route answers 404 there rather than pretending to work.
 *
 * The declared MIME type is ignored: the magic bytes decide the stored type and
 * extension (FR-025), which also blocks a text file renamed to `.png`.
 */
function json(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

async function uploadMedia(request: Request): Promise<Response> {
  if (getMediaMode() !== 'fs') {
    return json(404, 'not_found');
  }

  const user = await getSessionUser();
  if (!user) {
    return json(401, 'unauthorized');
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return json(400, 'invalid_form');
  }

  const orgId = String(form.get('orgId') ?? '');
  const articleId = String(form.get('articleId') ?? '');
  const file = form.get('file');

  // Reject on size *before* copying the whole payload into memory. The form is
  // already buffered by `request.formData()`, so this guard caps the in-process
  // copy, not the platform-level body limit (that lives on Vercel).
  const guard = checkUploadLimits(file, MAX_IMAGE_BYTES);
  if (!guard.ok) {
    return json(guard.status, guard.error);
  }

  const bytes = new Uint8Array(await guard.file.arrayBuffer());
  const contentType = sniffImageContentType(bytes);
  const allowed: readonly string[] = ARTICLE_IMAGE_CONTENT_TYPES;
  if (!contentType || !allowed.includes(contentType)) {
    return json(415, 'unsupported_media_type');
  }

  const pathname = buildMediaPathname(
    orgId,
    articleId,
    mediaFilenameFor(crypto.randomUUID(), contentType)
  );
  if (!parseMediaPathname(pathname)) {
    return json(400, 'invalid_target');
  }

  const role = await getOrgRole(user.id, orgId);
  if (!role || !hasPermission(role, 'article.write')) {
    return json(404, 'not_found');
  }
  const article = await getArticleScope(user.id, orgId, articleId);
  if (!article) {
    return json(404, 'not_found');
  }

  await fsMediaStore.put(pathname, bytes, contentType);

  return Response.json({
    pathname,
    size: bytes.byteLength,
    contentType,
  });
}

export const POST = withApiLogging('media-upload', uploadMedia);
