import { PageHeader } from '@/components/console/page-header';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

const SKELETON_CARDS = ['stat-1', 'stat-2', 'stat-3', 'stat-4'];

export default function OrgPageSkeleton() {
  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader title="加载中" description="正在读取组织数据…" />
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {SKELETON_CARDS.map((key) => (
          <Card key={key} size="dense" className="gap-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-24" />
          </Card>
        ))}
      </div>
    </section>
  );
}
