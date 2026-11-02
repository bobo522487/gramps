import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as blobUploadRoute } from '@/app/api/blob/upload/route';
import { GET as mediaReadRoute } from '@/app/api/media/[...key]/route';
import { POST as mediaUploadRoute } from '@/app/api/media/upload/route';
import { MAX_IMAGE_BYTES, MEDIA_PATH_ROOT } from '@/lib/article/constants';
import { fsMediaStore } from '@/lib/article/media/fs-store';
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

beforeEach(() => {
  session.cookie = undefined;
});

async function signIn(user: { email: string }) {
  session.cookie = await signSessionFor(user.email);
}

/** 真 PNG 的头 16 字节：魔数校验只认这些，不看 MIME 声明。 */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0xd, 0, 0, 0, 0,
]);
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38,
  0x20,
]);
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1,
]);

function readUrl(pathname: string) {
  return new Request(`http://localhost/api/media/${pathname}`);
}

function readContext(pathname: string) {
  return { params: Promise.resolve({ key: pathname.split('/') }) };
}

async function uploadRequest(params: {
  orgId: string;
  articleId: string;
  body: Uint8Array<ArrayBuffer>;
  type: string;
  name?: string;
}) {
  const form = new FormData();
  form.set('orgId', params.orgId);
  form.set('articleId', params.articleId);
  form.set(
    'file',
    new Blob([params.body], { type: params.type }),
    params.name ?? 'seed.png'
  );
  return new Request('http://localhost/api/media/upload', {
    method: 'POST',
    body: form,
  });
}

type Fixture = {
  orgId: string;
  articleId: string;
  pathname: string;
  ownerEmail: string;
  editorEmail: string;
  outsiderEmail: string;
};

async function makeFixture(): Promise<Fixture> {
  const owner = await createUser();
  const editor = await createUser();
  const outsider = await createUser();
  const organization = await createOrganization({ name: '媒体测试组织' });
  await addMember({
    userId: owner.id,
    organizationId: organization.id,
    role: 'owner',
  });
  await addMember({
    userId: editor.id,
    organizationId: organization.id,
    role: 'editor',
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

  return {
    orgId: organization.id,
    articleId: article.id,
    pathname: `${MEDIA_PATH_ROOT}/${organization.id}/${article.id}/seed.png`,
    ownerEmail: owner.email,
    editorEmail: editor.email,
    // outsider 只拥有自己那个组织，与上面的组织无关
    outsiderEmail: outsider.email,
  };
}

describe('media store（本地兜底驱动）', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await makeFixture();
  });

  afterAll(async () => {
    await fsMediaStore.cleanup();
  });

  it('没有 BLOB_READ_WRITE_TOKEN 时用文件系统驱动', () => {
    expect(getMediaStore().mode).toBe('fs');
  });

  it('put → read → delete 闭环', async () => {
    await fsMediaStore.put(fixture.pathname, PNG_BYTES, 'image/png');

    const stored = await fsMediaStore.read(fixture.pathname);
    expect(stored).not.toBeNull();
    expect(stored?.contentType).toBe('image/png');
    expect(stored?.bytes).toEqual(PNG_BYTES);

    await fsMediaStore.delete(fixture.pathname);
    expect(await fsMediaStore.read(fixture.pathname)).toBeNull();
  });

  it('读不存在的路径返回 null，不抛错', async () => {
    const missing = await fsMediaStore.read(
      `${MEDIA_PATH_ROOT}/${fixture.orgId}/${fixture.articleId}/nope.png`
    );

    expect(missing).toBeNull();
  });

  it('删除不存在的路径是幂等的', async () => {
    await expect(
      fsMediaStore.delete(
        `${MEDIA_PATH_ROOT}/${fixture.orgId}/${fixture.articleId}/gone.png`
      )
    ).resolves.toBeUndefined();
  });

  it('拒绝越出媒体根目录的路径', async () => {
    await expect(
      fsMediaStore.put('../../escape.png', PNG_BYTES, 'image/png')
    ).rejects.toThrow();
    await expect(fsMediaStore.read('../../escape.png')).rejects.toThrow();
  });
});

describe('GET /api/media/[...key]（读取代理）', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await makeFixture();
    await fsMediaStore.put(fixture.pathname, PNG_BYTES, 'image/png');
  });

  afterAll(async () => {
    await fsMediaStore.cleanup();
  });

  it('组织成员能读到自己谱文的图片', async () => {
    await signIn({ email: fixture.ownerEmail });

    const response = await mediaReadRoute(
      readUrl(fixture.pathname),
      readContext(fixture.pathname)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it('编辑者同样能读', async () => {
    await signIn({ email: fixture.editorEmail });

    const response = await mediaReadRoute(
      readUrl(fixture.pathname),
      readContext(fixture.pathname)
    );

    expect(response.status).toBe(200);
  });

  it('未登录 404', async () => {
    const response = await mediaReadRoute(
      readUrl(fixture.pathname),
      readContext(fixture.pathname)
    );

    expect(response.status).toBe(404);
  });

  it('非本组织成员（自己有别的组织）404，不泄露存在性', async () => {
    await signIn({ email: fixture.outsiderEmail });

    const response = await mediaReadRoute(
      readUrl(fixture.pathname),
      readContext(fixture.pathname)
    );

    expect(response.status).toBe(404);
  });

  it('pathname 形状不合法一律 404', async () => {
    await signIn({ email: fixture.ownerEmail });

    const bad = [
      'evil/a.png',
      `media/${fixture.orgId}/${fixture.articleId}/a.png`,
      `articles/${fixture.orgId}/not-a-uuid/a.png`,
      `articles/${fixture.orgId}/${fixture.articleId}/a/b.png`,
      `articles/${fixture.orgId}/${fixture.articleId}/..%2F..%2Fetc.png`,
    ];
    for (const pathname of bad) {
      const response = await mediaReadRoute(
        readUrl(pathname),
        readContext(pathname)
      );
      expect(response.status, pathname).toBe(404);
    }
  });

  it('文件不存在 404', async () => {
    await signIn({ email: fixture.ownerEmail });
    const missing = `${MEDIA_PATH_ROOT}/${fixture.orgId}/${fixture.articleId}/missing.png`;

    const response = await mediaReadRoute(
      readUrl(missing),
      readContext(missing)
    );

    expect(response.status).toBe(404);
  });

  it('谱文软删之后新的读取一律 404（FR-029 的第二条腿）', async () => {
    // 删字节只是第一半：清理失败过、或历史上没走到清理，谱文一旦删掉
    // 就不许再有请求能把图取出来。
    await signIn({ email: fixture.ownerEmail });
    await fsMediaStore.put(fixture.pathname, PNG_BYTES, 'image/png');
    await expect(
      mediaReadRoute(readUrl(fixture.pathname), readContext(fixture.pathname))
    ).resolves.toMatchObject({ status: 200 });

    await softDeleteArticle(fixture.articleId);

    const response = await mediaReadRoute(
      readUrl(fixture.pathname),
      readContext(fixture.pathname)
    );
    expect(response.status).toBe(404);
    await fsMediaStore.delete(fixture.pathname);
  });
});

describe('POST /api/media/upload（文件系统模式通道）', () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await makeFixture();
  });

  afterAll(async () => {
    await fsMediaStore.cleanup();
  });

  it('成员上传合法 PNG 后能立刻读回来', async () => {
    await signIn({ email: fixture.ownerEmail });

    const response = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: fixture.articleId,
        body: PNG_BYTES,
        type: 'image/png',
      })
    );

    expect(response.status).toBe(200);
    const stored = (await response.json()) as {
      pathname: string;
      size: number;
    };
    expect(
      stored.pathname.startsWith(
        `${MEDIA_PATH_ROOT}/${fixture.orgId}/${fixture.articleId}/`
      )
    ).toBe(true);
    expect(stored.size).toBe(PNG_BYTES.byteLength);

    const read = await mediaReadRoute(
      readUrl(stored.pathname),
      readContext(stored.pathname)
    );
    expect(read.status).toBe(200);
  });

  it('WebP 与 JPEG 魔数都放行，扩展名跟着实际类型走', async () => {
    await signIn({ email: fixture.ownerEmail });

    const webp = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: fixture.articleId,
        body: WEBP_BYTES,
        type: 'image/webp',
        name: 'a.bin',
      })
    );
    const jpeg = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: fixture.articleId,
        body: JPEG_BYTES,
        type: 'image/jpeg',
        name: 'b.bin',
      })
    );

    expect(webp.status).toBe(200);
    expect(jpeg.status).toBe(200);
    const webpPath = (await webp.json()) as { pathname: string };
    const jpegPath = (await jpeg.json()) as { pathname: string };
    expect(webpPath.pathname.endsWith('.webp')).toBe(true);
    expect(jpegPath.pathname.endsWith('.jpg')).toBe(true);
  });

  it('按魔数拒绝伪装成 PNG 的文本（415）', async () => {
    await signIn({ email: fixture.editorEmail });
    const forged = new TextEncoder().encode('这不是图片，只是声明了 image/png');

    const response = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: fixture.articleId,
        body: forged,
        type: 'image/png',
      })
    );

    expect(response.status).toBe(415);
  });

  it('拒绝超过 10MB（413）', async () => {
    await signIn({ email: fixture.ownerEmail });
    const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
    big.set(PNG_BYTES, 0);

    const request = await uploadRequest({
      orgId: fixture.orgId,
      articleId: fixture.articleId,
      body: big,
      type: 'image/png',
    });
    const response = await mediaUploadRoute(request);

    expect(response.status).toBe(413);
  });

  it('非成员 404 且不落盘', async () => {
    await signIn({ email: fixture.outsiderEmail });

    const response = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: fixture.articleId,
        body: PNG_BYTES,
        type: 'image/png',
      })
    );

    expect(response.status).toBe(404);
    const leaked = await fsMediaStore.read(
      `${MEDIA_PATH_ROOT}/${fixture.orgId}/${fixture.articleId}/seed.png`
    );
    expect(leaked).toBeNull();
  });

  it('articleId 不属于本组织 404', async () => {
    await signIn({ email: fixture.ownerEmail });

    const response = await mediaUploadRoute(
      await uploadRequest({
        orgId: fixture.orgId,
        articleId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a99',
        body: PNG_BYTES,
        type: 'image/png',
      })
    );

    expect(response.status).toBe(404);
  });

  it('缺文件时 400', async () => {
    await signIn({ email: fixture.ownerEmail });
    const form = new FormData();
    form.set('articleId', fixture.articleId);
    const request = new Request('http://localhost/api/media/upload', {
      method: 'POST',
      body: form,
    });

    const response = await mediaUploadRoute(request);

    expect(response.status).toBe(400);
  });
});

describe('POST /api/blob/upload（仅 Blob 模式）', () => {
  it('测试环境没有 BLOB_READ_WRITE_TOKEN → 404', async () => {
    const response = await blobUploadRoute(
      new Request('http://localhost/api/blob/upload', { method: 'POST' })
    );

    expect(response.status).toBe(404);
  });
});
