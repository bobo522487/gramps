'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { logger } from '@/lib/logger';

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error('Unhandled route error', error, { digest: error.digest });
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="mb-4 text-2xl font-semibold">出了点问题</h1>
      <p className="text-muted-foreground mb-8">发生了意外错误，请稍后重试。</p>
      <Button onClick={reset}>重试</Button>
    </main>
  );
}
