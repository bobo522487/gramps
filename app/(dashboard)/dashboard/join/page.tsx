import { Mail } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { AcceptInvitePanel } from '@/components/org/accept-invite-panel';
import { requireUser } from '@/lib/auth/context';
import { previewInvitation } from '@/lib/org/invitations';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const user = await requireUser();
  const { token } = await searchParams;
  if (!token) {
    redirect('/dashboard');
  }

  // 待加入者在接受之前不是成员，`invite` 的 org_isolation 让他一行都看不见，
  // 所以预览走 SECURITY DEFINER 的 `app.invite_join_preview`：只回组织名与角色。
  //
  // 查不到只说明「链接无效」，不再区分「过期 / 已撤销 / 已被别人用掉」——
  // 区分了就成了一张探测 token 是否曾经存在的接口。
  const preview = await previewInvitation(user.id, token);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Mail}
        title="组织邀请"
        description="确认加入邀请方组织。"
      />
      {preview ? (
        <AcceptInvitePanel invitation={{ ...preview, token }} />
      ) : (
        <AcceptInvitePanel error="邀请无效或已过期，请让管理员重新邀请。" />
      )}
    </section>
  );
}
