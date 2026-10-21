import { FileText } from 'lucide-react';
import { EmptyState } from '@/components/console/empty-state';
import { PageHeader } from '@/components/console/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { requireProjectContext } from '@/lib/auth/context';

export default async function ProjectArticlesPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const context = await requireProjectContext(projectRef);

  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader
        icon={FileText}
        title="谱文"
        description={`收录「${context.project.name}」的谱序、传记与其他文字记录。`}
      />
      <Card size="dense">
        <CardContent>
          <EmptyState
            icon={FileText}
            title="功能尚未开放"
            description="谱文编辑器将在后续版本开放，届时文字记录会显示在这里。"
          />
        </CardContent>
      </Card>
    </section>
  );
}
