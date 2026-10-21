'use client';

import { AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

export function RouteError({
  error,
  reset,
  scope,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  scope: string;
}) {
  useEffect(() => {
    logger.error(`Unhandled ${scope} route error`, error, {
      digest: error.digest,
    });
  }, [error, scope]);

  return (
    <section className="flex flex-col items-center justify-center gap-3 p-12 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <h2 className="text-lg font-semibold">页面加载失败</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        发生了意外错误，请稍后重试。如果问题持续出现，请刷新页面。
      </p>
      <Button variant="outline" size="sm" onClick={reset}>
        重试
      </Button>
    </section>
  );
}
