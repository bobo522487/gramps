import { withApiLogging } from '@/lib/api';
import {
  buildMediaPathname,
  parseMediaPathname,
} from '@/lib/article/media/path';
import { getMediaStore } from '@/lib/article/media/store';
import { getSessionUser } from '@/lib/auth/context';
import { getArticleScopeForMember } from '@/lib/db/queries/articles';

/**
 * The read proxy (ADR 0019): private image bytes never have a public URL, so
 * every fetch goes through here and is authorized per request. Any failure —
 * no session, non-member, bad shape, missing file — answers the same 404 so
 * the route cannot be used to probe which articles exist (FR-034).
 */
type RouteContext = { params: Promise<{ key: string[] }> };

function notFound(): Response {
  return new Response(null, { status: 404 });
}

async function readMedia(
  _request: Request,
  context: RouteContext
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return notFound();
  }

  const { key } = await context.params;
  const parts = parseMediaPathname(key);
  if (!parts) {
    return notFound();
  }

  // Membership + article scope in one transaction: a non-member or a deleted
  // article both yield null. Target state has no `deleted_at`, so this also
  // fulfils "after a successful delete, new requests cannot read the bytes"
  // (FR-029).
  const article = await getArticleScopeForMember(
    user.id,
    parts.orgId,
    parts.articleId
  );
  if (!article) {
    return notFound();
  }

  const target = buildMediaPathname(
    parts.orgId,
    parts.articleId,
    parts.filename
  );
  const store = getMediaStore();

  // 私有桶：授权已经在这里做完，字节改由存储域名直发给浏览器（ADR 0019）。
  // 302 本身不缓存，删除之后新的请求一定会重新走一遍上面的授权。
  const direct = await store.readRedirect(target);
  if (direct) {
    return new Response(null, {
      status: 302,
      headers: { Location: direct, 'Cache-Control': 'no-store' },
    });
  }

  const media = await store.read(target);
  if (!media) {
    return notFound();
  }

  return new Response(new Blob([media.bytes], { type: media.contentType }), {
    headers: {
      'Content-Type': media.contentType,
      // 本地兜底驱动没有直连域名，仍由本路由发字节。
      'Cache-Control': 'no-store',
      // 字节来自用户上传，禁止浏览器嗅探出图片以外的类型（ADR 0019）。
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const GET = withApiLogging('media-read', readMedia);
