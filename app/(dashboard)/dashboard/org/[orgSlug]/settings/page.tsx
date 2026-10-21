import { Settings } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { OrgSettingsPanel } from '@/components/org/org-settings-panel';
import { getOrgWithRoleBySlug, getProjects, getUser } from '@/lib/db/queries';

export default async function OrgSettingsPage({
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

  const projects = await getProjects(scope.organization.id);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Settings}
        title="组织设置"
        description={`重命名组织，或将组织连同 ${projects.length} 个项目、成员与活动记录一并删除。`}
      />
      <OrgSettingsPanel
        orgId={scope.organization.id}
        orgName={scope.organization.name}
        orgSlug={scope.organization.slug}
        projectCount={projects.length}
      />
    </section>
  );
}
