import { Mail } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { AcceptInvitePanel } from '@/components/org/accept-invite-panel';
import { requireUser } from '@/lib/auth/context';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  await requireUser();
  const { token } = await searchParams;
  if (!token) {
    redirect('/dashboard');
  }

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Mail}
        title="组织邀请"
        description="确认加入邀请方组织。"
      />
      <AcceptInvitePanel token={token} />
    </section>
  );
}
