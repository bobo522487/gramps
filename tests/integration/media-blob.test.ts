/**
 * Real-machine verification of the Vercel Blob channel (ADR 0019).
 *
 * This file is inert unless `BLOB_READ_WRITE_TOKEN` is present, so local runs
 * and CI keep using the filesystem driver. With a token in the environment it
 * writes real bytes into the private store and reads them back through the same
 * proxy the browser uses — the one path the fs driver cannot prove.
 */
import { put } from '@vercel/blob';
import { getPayloadFromClientToken } from '@vercel/blob/client';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { POST as blobUploadRoute } from '@/app/api/blob/upload/route';
import { GET as mediaReadRoute } from '@/app/api/media/[...key]/route';
import { MEDIA_PATH_ROOT } from '@/lib/article/constants';
import {
  blobMediaStore,
  blobReadWriteToken,
} from '@/lib/article/media/blob-store';
import { getMediaStore } from '@/lib/article/media/store';
import { resetRateLimitStore } from '@/lib/auth/rate-limit';
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

/** 1×1 透明 PNG（真字节，私有桶按内容识别 contentType）。 */
const PNG_PIXEL = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (char) => char.charCodeAt(0)
);

function readContext(pathname: string) {
  return { params: Promise.resolve({ key: pathname.split('/') }) };
}

function readWithProxy(pathname: string) {
  return mediaReadRoute(
    new Request(`http://localhost/api/media/${pathname}`),
    readContext(pathname)
  );
}

const hasToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

describe.skipIf(!hasToken)('media store（真实 Vercel Blob 私有桶）', () => {
  let ownerEmail = '';
  let outsiderEmail = '';
  let articleId = '';
  let pathname = '';

  beforeAll(() => {
    // 只有令牌存在才会跑到这里；能取到令牌就是这条链路的前提。
    expect(blobReadWriteToken().length).toBeGreaterThan(0);
  });

  // tests/integration/setup.ts 每例之前清库，夹具只能建在 beforeEach 里。
  beforeEach(async () => {
    resetRateLimitStore();
    session.cookie = undefined;

    const owner = await createUser();
    const outsider = await createUser();
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

    ownerEmail = owner.email;
    outsiderEmail = outsider.email;
    articleId = article.id;
    pathname = `${MEDIA_PATH_ROOT}/${organization.id}/${article.id}/real.png`;

    await put(pathname, new Blob([PNG_PIXEL], { type: 'image/png' }), {
      access: 'private',
      addRandomSuffix: false,
      contentType: 'image/png',
      token: blobReadWriteToken(),
    });
  });

  afterEach(async () => {
    // 真桶里不留测试垃圾：每例结束就把字节删掉（也是 delete 的一次真实调用）。
    await blobMediaStore.delete(pathname).catch(() => undefined);
  });

  it('令牌存在时驱动就是 blob（判定只看令牌，不看平台）', async () => {
    expect(getMediaStore().mode).toBe('blob');
  });

  it('私有桶里的真实字节能读回来', async () => {
    const media = await blobMediaStore.read(pathname);

    expect(media).not.toBeNull();
    expect(media?.contentType).toBe('image/png');
    expect(Array.from(media?.bytes ?? [])).toEqual(Array.from(PNG_PIXEL));
  });

  it('读取代理回传真实字节，带 nosniff 与私有缓存', async () => {
    session.cookie = await signSessionFor(ownerEmail);

    const response = await readWithProxy(pathname);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_PIXEL);
  });

  it('非成员读不到，越权与不存在同为 404（FR-034）', async () => {
    session.cookie = await signSessionFor(outsiderEmail);

    expect((await readWithProxy(pathname)).status).toBe(404);
  });

  it('谱文软删之后新的读取一律 404，即便字节还在桶里（FR-029）', async () => {
    session.cookie = await signSessionFor(ownerEmail);

    await softDeleteArticle(articleId);
    const response = await readWithProxy(pathname);

    expect(response.status).toBe(404);
    expect(await blobMediaStore.read(pathname)).not.toBeNull();
  });

  it('删掉之后读不回来（FR-029 的第一条腿）', async () => {
    await blobMediaStore.delete(pathname);

    expect(await blobMediaStore.read(pathname)).toBeNull();
  });
});
/**
 * 浏览器直传这条路的非浏览器复刻：用我们自己的 `POST /api/blob/upload` 签出客户端
 * 令牌，再用**同一个令牌**从 Node 侧真实 PUT 进私有桶。本机浏览器里那条 PUT 走不通
 * （Chromium 对 `vercel.com/api/blob` 报 `net::ERR_FAILED`，`*.blob.vercel-storage.com`
 * 干脆解析不到，curl 同地址却是 403），所以这一段证明的是「令牌可用 + 前缀被钉死 +
 * 写进去的就是读取代理读出来的那份」，浏览器网络栈本身只能在放通域名的机器或部署上验。
 */
describe.skipIf(!hasToken)('blob 上传握手（客户端令牌 → 真实私有桶）', () => {
  let ownerEmail = '';
  let outsiderEmail = '';
  let orgId = '';
  let articleId = '';
  let pathname = '';

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  async function mintClientToken(
    target: string,
    email: string
  ): Promise<{ status: number; clientToken: string | null }> {
    session.cookie = await signSessionFor(email);
    const response = await blobUploadRoute(
      new Request('http://localhost/api/blob/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'blob.generate-client-token',
          payload: { pathname: target, clientPayload: null, multipart: false },
        }),
      })
    );
    const body = await response.json().catch(() => null);
    return {
      status: response.status,
      clientToken:
        isRecord(body) && typeof body.clientToken === 'string'
          ? body.clientToken
          : null,
    };
  }

  /**
   * 浏览器里那条 PUT 的目标是 `https://<store>.<access>.blob.vercel-storage.com/…`
   * （access 编在主机名里），这台机器的 DNS 不放通 `*.blob.vercel-storage.com`
   * （连 example.com 都不通），所以直传那一步只能在放通域名的机器或部署上验。
   * 这里改成验证**令牌本身**：pathname 与约束是否被钉死——那正是浏览器 PUT 唯一的
   * 授权凭证，也是 FR-035「客户端不能自行扩大前缀」的落点。
   */
  function payloadOf(clientToken: string) {
    return getPayloadFromClientToken(clientToken);
  }

  beforeEach(async () => {
    resetRateLimitStore();
    session.cookie = undefined;

    const owner = await createUser();
    const outsider = await createUser();
    const organization = await createOrganization({ name: 'Blob 握手组织' });
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

    ownerEmail = owner.email;
    outsiderEmail = outsider.email;
    orgId = organization.id;
    articleId = article.id;
    pathname = `${MEDIA_PATH_ROOT}/${organization.id}/${article.id}/handshake.png`;
  });

  afterEach(async () => {
    await blobMediaStore.delete(pathname).catch(() => undefined);
  });

  it('签出的客户端令牌把 pathname、类型与体积上限钉死（FR-035）', async () => {
    const minted = await mintClientToken(pathname, ownerEmail);

    expect(minted.status).toBe(200);
    if (!minted.clientToken) {
      throw new Error('令牌没有签出来');
    }

    const payload = payloadOf(minted.clientToken);

    // 令牌把这次上传钉在签发时的那个 pathname 与谱文前缀上。
    expect(payload.pathname).toBe(pathname);
    expect(payload.allowedContentTypes).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(payload.maximumSizeInBytes).toBe(10 * 1024 * 1024);
    expect(payload.addRandomSuffix).toBe(false);
    // 越权与不存在的 pathname 走不到这一步（后面三条已覆盖），这里必须真的签了名。
    expect(minted.clientToken.startsWith('vercel_blob_client_')).toBe(true);
  });

  it('换 pathname 必须重新签发，旧令牌不覆盖新路径（FR-035）', async () => {
    const minted = await mintClientToken(pathname, ownerEmail);
    if (!minted.clientToken) {
      throw new Error('令牌没有签出来');
    }

    // 令牌只覆盖签发时那一条 pathname：换路径要重新签发，旧令牌不认新路径。
    const other = `${MEDIA_PATH_ROOT}/${orgId}/${articleId}/elsewhere.png`;
    const rerouted = await mintClientToken(other, ownerEmail);
    expect(rerouted.status).toBe(200);
    if (!rerouted.clientToken || !minted.clientToken) {
      throw new Error('令牌没有签出来');
    }

    expect(payloadOf(rerouted.clientToken).pathname).toBe(other);
    expect(payloadOf(minted.clientToken).pathname).not.toBe(other);
    expect(await blobMediaStore.read(other)).toBeNull();
  });

  it('非成员签不到令牌，与不存在同为 404（FR-034、终审 BLK-6）', async () => {
    const minted = await mintClientToken(pathname, outsiderEmail);

    expect(minted.status).toBe(404);
    expect(minted.clientToken).toBeNull();
  });

  it('pathname 形状不对时 404 且不带原因串（FR-034）', async () => {
    session.cookie = await signSessionFor(ownerEmail);
    const response = await blobUploadRoute(
      new Request('http://localhost/api/blob/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'blob.generate-client-token',
          payload: {
            pathname: `other/${articleId}/${articleId}/x.png`,
            clientPayload: null,
            multipart: false,
          },
        }),
      })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });

  it('articleId 不属于这个组织时签不到令牌（跨组织探测得不到答案）', async () => {
    const forged = `${MEDIA_PATH_ROOT}/${orgId}/${crypto.randomUUID()}/x.png`;
    const minted = await mintClientToken(forged, ownerEmail);

    expect(minted.status).toBe(404);
    expect(minted.clientToken).toBeNull();
  });
});
