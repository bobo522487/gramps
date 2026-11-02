import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadArticleImage } from '@/components/article/editor/image-upload';
import { ARTICLE_ERRORS } from '@/lib/article/constants';

/**
 * 插图上传（FR-025、FR-037、US3-AC4/AC5）。
 *
 * 客户端只做**预校验**（格式、体积、文件名给个即时中文提示），
 * 权威判定仍在服务端；这里同时验两种存储模式的调用形状。
 */

const orgId = 'a0000000-0000-0000-8000-000000000001';
const articleId = 'b0000000-0000-0000-8000-000000000002';
const MAX = 10 * 1024 * 1024;

type BlobUpload = (
  pathname: string,
  body: Blob,
  options: { access: 'public' | 'private'; handleUploadUrl: string }
) => Promise<{ pathname: string }>;

const blobClient = vi.hoisted(() => ({ upload: vi.fn<BlobUpload>() }));
vi.mock('@vercel/blob/client', () => blobClient);

function pngFile(name = '祖先像.png', size = 1024): File {
  const file = new File([new Uint8Array(size)], name, { type: 'image/png' });
  return file;
}

beforeEach(() => {
  blobClient.upload.mockReset();
  vi.unstubAllGlobals();
});

describe('uploadArticleImage 预校验', () => {
  it('格式不在白名单：中文拒绝，一次请求都不发', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: new File([new Uint8Array(8)], '手抄.pdf', {
        type: 'application/pdf',
      }),
    });

    // 文案与服务端同源（lib/article/constants.ts），客户端不许另造一套。
    expect(result).toEqual({ error: ARTICLE_ERRORS.invalid_image });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(blobClient.upload).not.toHaveBeenCalled();
  });

  it('超过 10MB：中文拒绝，不发起上传', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: pngFile('大图.png', MAX + 1),
    });

    expect(result).toEqual({ error: ARTICLE_ERRORS.invalid_image });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空文件也挡在客户端', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: pngFile('空.png', 0),
    });

    expect(result).toEqual({ error: '这张图片是空的，换一张试试' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('uploadArticleImage 文件系统模式', () => {
  it('POST /api/media/upload，把服务端定的 pathname 带回来', async () => {
    const pathname = `articles/${orgId}/${articleId}/x.png`;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        Response.json({ pathname, size: 1024 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: pngFile(),
    });

    expect(result).toEqual({ pathname });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/media/upload');
    const body = init?.body as FormData;
    expect(body.get('orgId')).toBe(orgId);
    expect(body.get('articleId')).toBe(articleId);
    expect((body.get('file') as File).name).toBe('祖先像.png');
  });

  it('服务端拒绝时用它的中文文案', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response('{"error":"这张图片太大"}', { status: 413 })
      )
    );

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: pngFile(),
    });

    expect(result).toEqual({ error: '这张图片太大' });
  });

  it('服务端没给文案时用兜底中文', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_url: string | URL | Request, _init?: RequestInit) =>
          new Response('', { status: 415 })
      )
    );

    const result = await uploadArticleImage({
      mode: 'fs',
      orgId,
      articleId,
      file: pngFile(),
    });

    expect(result).toEqual({ error: '这张图片没能上传，请换一张试试' });
  });
});

describe('uploadArticleImage Blob 模式', () => {
  it('客户端直传，pathname 由我们自己按规则拼并带随机后缀', async () => {
    const blob = { pathname: `articles/${orgId}/${articleId}/random.png` };
    blobClient.upload.mockResolvedValue(blob);

    const result = await uploadArticleImage({
      mode: 'blob',
      orgId,
      articleId,
      file: pngFile(),
    });

    expect(result).toEqual({ pathname: blob.pathname });
    const [pathname, body, options] = blobClient.upload.mock.calls[0];
    expect(pathname).toMatch(
      new RegExp(`^articles/${orgId}/${articleId}/.+\\.png$`)
    );
    expect(body).toBeInstanceOf(File);
    expect(options).toMatchObject({
      access: 'private',
      handleUploadUrl: '/api/blob/upload',
    });
  });

  it('令牌被服务端拒绝时给中文提示', async () => {
    blobClient.upload.mockRejectedValue(new Error('Image generation failed'));

    const result = await uploadArticleImage({
      mode: 'blob',
      orgId,
      articleId,
      file: pngFile(),
    });

    expect(result).toEqual({ error: '这张图片没能上传，请换一张试试' });
  });
});
