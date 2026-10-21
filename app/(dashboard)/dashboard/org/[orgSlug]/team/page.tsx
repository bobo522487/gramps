import { Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import type { MemberView } from '@/components/org/members-panel';
import { MembersPanel } from '@/components/org/members-panel';
import { Badge } from '@/components/ui/badge';
import { requireOrgContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getOrgWithMembersById } from '@/lib/db/queries/organizations';

export default async function OrgTeamPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const org = await getOrgWithMembersById(
    context.user.id,
    context.organization.id
  );
  if (!org) {
    notFound();
  }

  const members: MemberView[] = org.members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    joinedAt: member.createdAt.toISOString().slice(0, 10),
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
        canInvite={hasPermission(context.role, 'member.invite')}
        canManage={hasPermission(context.role, 'member.manage')}
        canManageAdmins={context.role === 'owner'}
      />
    </section>
  );
}
