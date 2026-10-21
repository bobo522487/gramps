import { Activity } from 'lucide-react';
import { PageHeader } from '@/components/console/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function ActivityPageSkeleton() {
  return (
    <section className="space-y-4 p-4 lg:p-6">
      <PageHeader icon={Activity} title="活动日志" />
      <Card size="dense">
        <CardHeader>
          <CardTitle>最近活动</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-8 w-2/5" />
        </CardContent>
      </Card>
    </section>
  );
}
