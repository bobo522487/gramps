'use client';

import { upload } from '@vercel/blob/client';

import {
  ARTICLE_ERRORS,
  ARTICLE_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_BYTES,
} from '@/lib/article/constants';
import { buildMediaPathname, mediaFilenameFor } from '@/lib/article/media/path';

/**
 * 谱文插图的上传通道（FR-025、FR-037、ADR 0019）。
 *
 * 两种模式的区别只在**字节怎么走**：Blob 模式由浏览器直传 Vercel（10MB 的图片
 * 走 Server Action 或函数体积上限都会撞墙），文件系统模式给本地开发兜底。
 * 客户端这三条只是预校验，为了让用户立刻看到中文提示；权威判定在服务端，
 * 绕不过去。
 */

const allowed: readonly string[] = ARTICLE_IMAGE_CONTENT_TYPES;

/** 上传通道本身出问题时给用户的兜底中文（FR-015：不许只报天书）。 */
const UPLOAD_FALLBACK = '这张图片没能上传，请换一张试试';

export type UploadResult = { pathname: string } | { error: string };

export async function uploadArticleImage(params: {
  mode: 'blob' | 'fs';
  orgId: string;
  articleId: string;
  file: File;
}): Promise<UploadResult> {
  const { mode, orgId, articleId, file } = params;

  if (!allowed.includes(file.type)) {
    return { error: ARTICLE_ERRORS.invalid_image };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: ARTICLE_ERRORS.invalid_image };
  }
  if (file.size === 0) {
    return { error: '这张图片是空的，换一张试试' };
  }

  if (mode === 'blob') {
    // 文档里要存最终地址，所以 pathname 由编辑器自己按规则拼好再上传。
    const target = buildMediaPathname(
      orgId,
      articleId,
      mediaFilenameFor(crypto.randomUUID(), file.type)
    );
    try {
      const blob = await upload(target, file, {
        access: 'private',
        handleUploadUrl: '/api/blob/upload',
      });
      return { pathname: blob.pathname };
    } catch {
      // 令牌被服务端拒（非成员、形状不符）也落到这句中文提示里。
      return { error: UPLOAD_FALLBACK };
    }
  }

  const form = new FormData();
  form.set('orgId', orgId);
  form.set('articleId', articleId);
  form.set('file', file, file.name);

  let response: Response;
  try {
    response = await fetch('/api/media/upload', { method: 'POST', body: form });
  } catch {
    return { error: UPLOAD_FALLBACK };
  }

  if (!response.ok) {
    // 服务端已经把「太大 / 格式不符 / 没权限」说成中文，这里不另造文案。
    const message = errorMessage(await readJson(response));
    return { error: message || UPLOAD_FALLBACK };
  }

  const body = await readJson(response);
  const pathname =
    body &&
    typeof body === 'object' &&
    'pathname' in body &&
    typeof body.pathname === 'string'
      ? body.pathname
      : '';
  return pathname ? { pathname } : { error: UPLOAD_FALLBACK };
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function errorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) {
    return '';
  }
  const error = payload.error;
  return typeof error === 'string' ? error.trim() : '';
}
