import { Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import type { MemberView } from '@/components/org/members-panel';
import { MembersPanel } from '@/components/org/members-panel';
import { Badge } from '@/components/ui/badge';
import { requireOrgContext } from '@/lib/auth/context';
import { getOrgWithMembersById } from '@/lib/db/queries/organizations';

export default async function OrgTeamPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const org = await getOrgWithMembersById(context.organization.id);
  if (!org) {
    notFound();
  }

  const members: MemberView[] = org.orgMembers.map((member) => ({
    id: member.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
    joinedAt: member.joinedAt.toISOString().slice(0, 10),
  }));

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Users}
        title="团队"
        description="可以查看并管理该组织项目的成员。"
        badge={<Badge variant="outline">{members.length}</Badge>}
      />
      <MembersPanel
        orgId={context.organization.id}
        members={members}
        isOwner={context.role === 'owner'}
      />
    </section>
  );
}
