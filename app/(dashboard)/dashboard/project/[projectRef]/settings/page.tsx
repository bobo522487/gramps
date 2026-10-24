import { Settings } from 'lucide-react';
import { PageHeader } from '@/components/console/page-header';
import { ProjectSettingsPanel } from '@/components/project/project-settings-panel';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';

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
        description="维护项目名、地区、状态、重要等级与备注；姓氏、主题名和项目 ID 创建后不可更改。"
      />
      <ProjectSettingsPanel
        orgId={context.organization.id}
        projectId={context.project.id}
        name={context.project.name}
        surname={context.project.surname}
        themeName={context.project.themeName}
        hallCode={context.project.hallCode}
        countriesRegions={context.project.countriesRegions}
        status={context.project.status}
        importance={context.project.importance}
        notes={context.project.notes}
        projectRef={context.project.ref}
        canManage={hasPermission(context.role, 'project.write')}
      />
    </section>
  );
}
