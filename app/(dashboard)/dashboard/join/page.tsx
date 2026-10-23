import { Mail } from 'lucide-react';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { AcceptInvitePanel } from '@/components/org/accept-invite-panel';
import { requireUser } from '@/lib/auth/context';
import { getInvitationDetails } from '@/lib/org/invitations';

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  await requireUser();
  const { invite } = await searchParams;
  if (!invite) {
    redirect('/dashboard');
  }

  const lookup = await getInvitationDetails(invite);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Mail}
        title="组织邀请"
        description="确认加入邀请方组织。"
      />
      {lookup.ok ? (
        <AcceptInvitePanel invitation={lookup.invitation} />
      ) : (
        <AcceptInvitePanel error={lookup.error} />
      )}
    </section>
  );
}
