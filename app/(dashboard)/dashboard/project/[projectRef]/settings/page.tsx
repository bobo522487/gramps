import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/console/page-header';
import { ProjectSettingsPanel } from '@/components/project/project-settings-panel';
import { requireProjectContext } from '@/lib/auth/context';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const context = await requireProjectContext(projectRef);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Settings}
        title="项目设置"
        description="修改项目名称与状态。项目 ID 创建后不可更改。"
      />
      <ProjectSettingsPanel
        orgId={context.organization.id}
        projectId={context.project.id}
        name={context.project.name}
        status={context.project.status}
        projectRef={context.project.ref}
        isOwner={context.role === 'owner'}
      />
    </section>
  );
}
