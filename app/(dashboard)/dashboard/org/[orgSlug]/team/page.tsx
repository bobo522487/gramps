import { Users } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import type { MemberView } from '@/components/org/members-panel';
import { MembersPanel } from '@/components/org/members-panel';
import { Badge } from '@/components/ui/badge';
import {
  getOrgWithMembersById,
  getOrgWithRoleBySlug,
  getUser,
} from '@/lib/db/queries';

export default async function OrgTeamPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const user = await getUser();
  if (!user) {
    notFound();
  }

  const scope = await getOrgWithRoleBySlug(user.id, orgSlug);
  if (!scope) {
    notFound();
  }

  const org = await getOrgWithMembersById(scope.organization.id);
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
        orgId={scope.organization.id}
        members={members}
        isOwner={scope.role === 'owner'}
      />
    </section>
  );
}
