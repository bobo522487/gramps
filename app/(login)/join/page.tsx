import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/context';

/**
 * 邀请链接的公开落地入口（B2b 自建 token）。
 *
 * 对外只暴露 `/join?token=<明文 token>`，内部复用已有的注册 / 接受邀请流程：
 * 未登录时把 token 作为注册表单的 `invite` 透传字段送去 `/sign-up`，注册成功后
 * `signUp` 会跳到 `/dashboard/join?token=...`；已登录则直接跳接受邀请页。
 * 参数名保持 `invite` 是为了不打断已有邮件链接和表单透传契约。
 */
export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) {
    redirect('/sign-up');
  }
  if (await getSessionUser()) {
    redirect(`/dashboard/join?token=${encodeURIComponent(token)}`);
  }
  redirect(`/sign-up?invite=${encodeURIComponent(token)}`);
}
