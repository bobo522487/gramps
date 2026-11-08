import { type HandleUploadBody, handleUpload } from '@vercel/blob/client';
import { withApiLogging } from '@/lib/api';
import {
  ARTICLE_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
} from '@/lib/article/constants';
import { parseMediaPathname } from '@/lib/article/media/path';
import { blobReadWriteToken } from '@/lib/article/media/token';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgRole, hasPermission } from '@/lib/auth/permissions';
import { getMediaMode } from '@/lib/config';
import { getArticleScope } from '@/lib/db/queries/articles';
import { logger } from '@/lib/logger';

/**
 * Token issuance for client-side direct uploads (Vercel Blob, ADR 0019).
 * Bytes never pass through this function — a 10MB image exceeds both the
 * 1MB Server Action body limit and the 4.5MB serverless body limit, which is
 * exactly why `handleUpload` hands the client a scoped token instead.
 *
 * Only reachable in Blob mode; `/api/media/upload` owns the filesystem mode.
 */
class UploadRefused extends Error {}

async function issueUploadToken(request: Request): Promise<Response> {
  if (getMediaMode() !== 'blob') {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = (await request
    .json()
    .catch(() => null)) as HandleUploadBody | null;
  if (!body) {
    return Response.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const result = await handleUpload({
      request,
      body,
      token: blobReadWriteToken(),
      onBeforeGenerateToken: async (pathname) => {
        const parts = parseMediaPathname(pathname);
        if (!parts) {
          throw new UploadRefused('invalid_target');
        }
        const role = await getOrgRole(user.id, parts.orgId);
        if (!role || !hasPermission(role, 'article.write')) {
          throw new UploadRefused('forbidden');
        }
        const article = await getArticleScope(
          user.id,
          parts.orgId,
          parts.articleId
        );
        if (!article) {
          throw new UploadRefused('not_found');
        }
        return {
          allowedContentTypes: [...ARTICLE_IMAGE_CONTENT_TYPES],
          maximumSizeInBytes: MAX_IMAGE_BYTES,
          // The editor builds the final pathname itself, so the document can
          // store it in the same turn the bytes land.
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({
            userId: user.id,
            orgId: parts.orgId,
            articleId: parts.articleId,
          }),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        // The document is written by `saveArticlePageAction`; bytes referenced
        // by nothing are reclaimed when the article is deleted (ADR 0019).
        logger.info('blob upload completed', {
          pathname: blob.pathname,
          contentType: blob.contentType,
        });
      },
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof UploadRefused) {
      // 拒绝原因只进日志：状态码与响应体一律「不存在」，否则查看者可以
      // 靠轮换 articleId 分辨某篇谱文在不在（FR-034）。
      logger.info('blob upload refused', {
        reason: error.message,
        userId: user.id,
      });
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    throw error;
  }
}

export const POST = withApiLogging('blob-upload', issueUploadToken);
