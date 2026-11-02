import { withApiLogging } from '@/lib/api';
import {
  buildMediaPathname,
  parseMediaPathname,
} from '@/lib/article/media/path';
import { getMediaStore } from '@/lib/article/media/store';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgRole } from '@/lib/auth/permissions';

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

  const role = await getOrgRole(user.id, parts.orgId);
  if (!role) {
    return notFound();
  }

  const media = await getMediaStore().read(
    buildMediaPathname(parts.orgId, parts.articleId, parts.filename)
  );
  if (!media) {
    return notFound();
  }

  return new Response(new Blob([media.bytes], { type: media.contentType }), {
    headers: {
      'Content-Type': media.contentType,
      'Cache-Control': 'private, max-age=300',
    },
  });
}

export const GET = withApiLogging('media-read', readMedia);
