import { Home } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/console/page-header';
import { StatusPill } from '@/components/console/status-pill';
import { Card } from '@/components/ui/card';
import { getProjectScopeByRef, getUser } from '@/lib/db/queries';
import { regionLabel } from '@/lib/ui/status';

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
  const user = await getUser();
  if (!user) {
    notFound();
  }

  const scope = await getProjectScopeByRef(user.id, projectRef);
  if (!scope) {
    notFound();
  }

  const { project, organization } = scope;
  const facts: {
    label: string;
    value: string;
    kind: 'mono' | 'text' | 'status' | 'health';
  }[] = [
    { label: '项目 ID', value: project.ref, kind: 'mono' },
    { label: '区域', value: regionLabel(project.region), kind: 'text' },
    { label: '状态', value: project.status, kind: 'status' },
    { label: '健康度', value: project.health, kind: 'health' },
    { label: '创建时间', value: formatDate(project.createdAt), kind: 'mono' },
    {
      label: '最近部署',
      value: formatDate(project.lastDeployedAt),
      kind: 'mono',
    },
  ];

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Home}
        title="概览"
        description={`${organization.name} / ${project.name}`}
        badge={
          <>
            <StatusPill
              value={project.status}
              pulse={project.status === 'ACTIVE'}
            />
            <StatusPill value={project.health} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {facts.map((fact) => (
          <Card key={fact.label} size="dense" className="gap-2">
            <p className="text-xs text-muted-foreground">{fact.label}</p>
            {fact.kind === 'status' ? (
              <StatusPill
                value={fact.value}
                pulse={fact.value === 'ACTIVE'}
                className="w-fit"
              />
            ) : fact.kind === 'health' ? (
              <StatusPill value={fact.value} className="w-fit" />
            ) : (
              <p
                className={
                  fact.kind === 'mono'
                    ? 'truncate font-mono text-sm font-medium'
                    : 'truncate text-sm font-medium'
                }
              >
                {fact.value}
              </p>
            )}
          </Card>
        ))}
      </div>
    </section>
  );
}
