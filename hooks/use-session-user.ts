'use client';

import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@/lib/auth/types';
import { fetcher } from '@/lib/fetcher';
import { queryKeys } from '@/lib/query-keys';

export function useSessionUser() {
  return useQuery({
    queryKey: queryKeys.user,
    queryFn: () => fetcher<SessionUser>('/api/user'),
  });
}
