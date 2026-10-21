import { BookOpen } from 'lucide-react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireProjectContext } from '@/lib/auth/context';

export default async function ProjectBooksPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const context = await requireProjectContext(projectRef);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={BookOpen}
        title="谱书"
        description={`汇编「${context.project.name}」的家谱成书。`}
      />
      <Card size="dense">
        <CardContent>
          <EmptyState
            icon={BookOpen}
            title="功能尚未开放"
            description="谱书汇编将在后续版本开放，届时成书内容会显示在这里。"
          />
        </CardContent>
      </Card>
    </section>
  );
}
