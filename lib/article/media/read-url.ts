import 'server-only';

import {
  type IssuedSignedToken,
  issueSignedToken,
  presignUrl,
} from '@vercel/blob';

import { blobReadWriteToken } from './token';

/**
 * 私有桶的读取直连签名（ADR 0019 的读取通道）。
 *
 * 官方把「让函数代传字节」列为成本上的反模式：每次读都收函数出网流量，还要在内存里
 * 把整张图拼起来。改成签名 URL 之后，函数只做一次授权判断并回一个 302，字节由存储
 * 域名直接给浏览器。签名本身是本地 HMAC，不打网络；只有 delegation 令牌需要一次
 * 控制面调用，所以按进程缓存一小时、提前五分钟换新。
 *
 * delegation 的作用域只能是单个 pathname 或整店 `*`。逐 pathname 签发意味着每图一次
 * 网络调用（一页最多 40 图，直接把 SC-003 打穿），所以取整店只读令牌，但**两个令牌
 * 串一律不出服务端**：我们只对自己已经完成授权判断的 pathname 签 URL。
 */

/** 单张图的直读 URL 有效期：与旧的浏览器缓存窗口同量级，删图后最多活这么久。 */
const READ_URL_TTL_MS = 5 * 60 * 1000;
/** 提前换新的余量，避免踩在过期边界上签名。 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let delegation: IssuedSignedToken | null = null;
let pending: Promise<IssuedSignedToken> | null = null;

async function issue(): Promise<IssuedSignedToken> {
  return issueSignedToken({
    operations: ['get'],
    token: blobReadWriteToken(),
  });
}

async function readDelegation(): Promise<IssuedSignedToken> {
  const now = Date.now();
  if (delegation && delegation.validUntil - now > REFRESH_MARGIN_MS) {
    return delegation;
  }
  // 并发首屏只打一次控制面。
  pending ??= issue().then((issued) => {
    delegation = issued;
    pending = null;
    return issued;
  });
  return pending;
}

/** 为**已完成授权**的 pathname 签一个短命的私有直读 URL。 */
export async function presignPrivateRead(
  pathname: string
): Promise<string | null> {
  try {
    const issued = await readDelegation();
    const { presignedUrl } = await presignUrl(issued, {
      access: 'private',
      operation: 'get',
      pathname,
      validUntil: Math.min(issued.validUntil, Date.now() + READ_URL_TTL_MS),
    });
    return presignedUrl;
  } catch {
    // 签不出来就退回函数代传：宁可慢，不可看不到图（读取代理本来就存在）。
    return null;
  }
}
