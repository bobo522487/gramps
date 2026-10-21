import { Network } from 'lucide-react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireProjectContext } from '@/lib/auth/context';

export default async function ProjectLineagesPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const context = await requireProjectContext(projectRef);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={Network}
        title="谱系"
        description={`为「${context.project.name}」整理家族世系。`}
      />
      <Card size="dense">
        <CardContent>
          <EmptyState
            icon={Network}
            title="功能尚未开放"
            description="谱系编辑器将在后续版本开放，届时家族树会显示在这里。"
          />
        </CardContent>
      </Card>
    </section>
  );
}
