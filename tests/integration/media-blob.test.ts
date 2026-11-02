/**
 * Real-machine verification of the Vercel Blob channel (ADR 0019).
 *
 * This file is inert unless `BLOB_READ_WRITE_TOKEN` is present, so local runs
 * and CI keep using the filesystem driver. With a token in `.env` it writes
 * real bytes into the private store and reads them back through the same
 * proxy the browser uses — the one path the fs driver cannot prove.
 */

import { put } from '@vercel/blob';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { GET as mediaReadRoute } from '@/app/api/media/[...key]/route';
import { MAX_IMAGE_BYTES, MEDIA_PATH_ROOT } from '@/lib/article/constants';
import {
  blobMediaStore,
  blobReadWriteToken,
} from '@/lib/article/media/blob-store';
import { getMediaStore } from '@/lib/article/media/store';
import { signSessionFor } from '../helpers/auth';
import {
  addMember,
  createArticle,
  createOrganization,
  createProject,
  createUser,
  softDeleteArticle,
} from '../helpers/factories';

const session = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
}));

vi.mock('next/headers', () => ({
  headers: async () => {
    const headers = new Headers();
    if (session.cookie) {
      headers.set('cookie', session.cookie);
    }
    return headers;
  },
}));

/** 1×1 透明 PNG（真字节，私有桶会按内容识别 contentType）。 */
const PNG_PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
);

function readContext(pathname: string) {
  return { params: Promise.resolve({ key: pathname.split('/') }) };
}

const hasToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

describe.skipIf(!hasToken)('media store（真实 Vercel Blob 私有桶）', () => {
  const owner = { email: '', id: '' };
  const outsider = { email: '', id: '' };
  let articleId = '';
  let pathname = '';

  beforeAll(async () => {
    const ownerUser = await createUser();
    const outsiderUser = await createUser();
    owner.id = ownerUser.id;
    owner.email = ownerUser.email;
    outsider.id = outsiderUser.id;
    outsider.email = outsiderUser.email;

    const organization = await createOrganization({
      name: 'Blob 真机验证组织',
    });
    await addMember({
      userId: owner.id,
      organizationId: organization.id,
      role: 'owner',
    });
    const project = await createProject({
      orgId: organization.id,
      createdBy: owner.id,
    });
    const article = await createArticle({
      orgId: organization.id,
      projectId: project.id,
      createdBy: owner.id,
    });
    articleId = article.id;
    pathname = `${MEDIA_PATH_ROOT}/${organization.id}/${article.id}/real.png`;

    await put(pathname, new Blob([PNG_PIXEL], { type: 'image/png' }), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'image/png',
      token: blobReadWriteToken(),
    });
  });

  afterAll(async () => {
    await blobMediaStore.delete(pathname).catch(() => undefined);
  });

  beforeEach(() => {
    session.cookie = undefined;
  });

  it('令牌存在时驱动就是 blob（判定只看令牌，不看平台）', async () => {
    expect(getMediaStore().mode).toBe('blob');
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
  });

  it('私有桶里的真实字节能读回来', async () => {
    const media = await blobMediaStore.read(pathname);

    expect(media).not.toBeNull();
    expect(media?.contentType).toBe('image/png');
    expect(Array.from(media?.bytes ?? [])).toEqual(Array.from(PNG_PIXEL));
  });

  it('读取代理回传真实字节，带 nosniff 与私有缓存', async () => {
    session.cookie = await signSessionFor(owner.email);

    const response = await mediaReadRoute(
      new Request(`http://localhost/api/media/${pathname}`),
      readContext(pathname)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_PIXEL);
  });

  it('非成员读不到，越权与不存在同为 404（FR-034）', async () => {
    session.cookie = await signSessionFor(outsider.email);

    const response = await mediaReadRoute(
      new Request(`http://localhost/api/media/${pathname}`),
      readContext(pathname)
    );

    expect(response.status).toBe(404);
  });

  it('谱文软删之后新的读取一律 404，即便字节还在桶里（FR-029）', async () => {
    session.cookie = await signSessionFor(owner.email);

    await softDeleteArticle(articleId);
    const response = await mediaReadRoute(
      new Request(`http://localhost/api/media/${pathname}`),
      readContext(pathname)
    );

    expect(response.status).toBe(404);
    expect(await blobMediaStore.read(pathname)).not.toBeNull();
  });

  it('删掉之后读不回来（FR-029 的第一条腿）', async () => {
    await blobMediaStore.delete(pathname);

    expect(await blobMediaStore.read(pathname)).toBeNull();
  });
});
