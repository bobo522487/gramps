import { Home } from 'lucide-react';
import { PageHeader } from '@/components/console/page-header';
import { Card } from '@/components/ui/card';
import { requireProjectContext } from '@/lib/auth/context';

function formatDate(value: Date | null): string {
  if (!value) {
    return '—';
  }
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)} UTC`;
}

export default async function ProjectOverviewPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const { project, organization } = await requireProjectContext(projectRef);
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: '项目 ID', value: project.ref, mono: true },
    { label: '主姓名', value: project.primaryName },
    { label: '主姓氏', value: project.primarySurname },
    { label: '郡望 / 堂号', value: project.hallCode ?? '—' },
    { label: '国家 / 地区', value: project.countriesRegions ?? '—' },
    { label: '创建时间', value: formatDate(project.createdAt), mono: true },
    { label: '最近更新', value: formatDate(project.updatedAt), mono: true },
  ];

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Home}
        title="概览"
        description={`${organization.name} / ${project.name}`}
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {facts.map((fact) => (
          <Card key={fact.label} size="dense" className="gap-2">
            <p className="text-xs text-muted-foreground">{fact.label}</p>
            <p
              className={
                fact.mono
                  ? 'truncate font-mono text-sm font-medium'
                  : 'truncate text-sm font-medium'
              }
            >
              {fact.value}
            </p>
          </Card>
        ))}
      </div>
    </section>
  );
}
