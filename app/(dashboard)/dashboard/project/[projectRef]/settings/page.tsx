import { Settings } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { ProjectSettingsPanel } from '@/components/project/project-settings-panel';
import { getProjectScopeByRef, getUser } from '@/lib/db/queries';

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const user = await getUser();
  if (!user) {
    notFound();
  }

  const scope = await getProjectScopeByRef(user.id, projectRef);
  if (!scope) {
    notFound();
  }

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Settings}
        title="项目设置"
        description="修改项目名称与状态。项目 ID 创建后不可更改。"
      />
      <ProjectSettingsPanel
        orgId={scope.organization.id}
        projectId={scope.project.id}
        name={scope.project.name}
        status={scope.project.status}
        projectRef={scope.project.ref}
        isOwner={scope.role === 'owner'}
      />
    </section>
  );
}
