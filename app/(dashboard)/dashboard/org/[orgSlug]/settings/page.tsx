import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/console/page-header';
import { OrgSettingsPanel } from '@/components/org/org-settings-panel';
import { requireOrgContext } from '@/lib/auth/context';
import { countProjects } from '@/lib/db/queries/projects';

export default async function OrgSettingsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const projectCount = await countProjects(
    context.user.id,
    context.organization.id
  );

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Settings}
        title="组织设置"
        description={`重命名组织，或归档组织及其 ${projectCount} 个云谱空间。`}
      />
      <OrgSettingsPanel
        orgId={context.organization.id}
        orgName={context.organization.name}
        orgSlug={context.organization.slug}
        projectCount={projectCount}
        isOwner={context.role === 'owner'}
      />
    </section>
  );
}
