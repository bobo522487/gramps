'use client';

import { RouteError } from '@/components/console/route-error';

export default function OrgError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteError error={error} reset={reset} scope="organization" />;
}
