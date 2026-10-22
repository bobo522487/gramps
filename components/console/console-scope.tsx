'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { fetcher } from '@/lib/fetcher';
import { queryKeys } from '@/lib/query-keys';

export type ConsoleScope = {
  org: { id: string; name: string; slug: string; role: string };
  project?: { id: string; name: string; ref: string };
};

const ConsoleScopeContext = createContext<ConsoleScope | null>(null);

export function ConsoleScopeProvider({
  scope,
  children,
}: {
  scope: ConsoleScope | null;
  children: ReactNode;
}) {
  return (
    <ConsoleScopeContext.Provider value={scope}>
      {children}
    </ConsoleScopeContext.Provider>
  );
}

export function useConsoleScope() {
  return useContext(ConsoleScopeContext);
}

export type ConsoleOrg = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export type ConsoleProject = {
  id: string;
  name: string;
  ref: string;
};

export function useConsoleOrgs() {
  return useQuery({
    queryKey: queryKeys.orgs,
    queryFn: () => fetcher<ConsoleOrg[]>('/api/orgs'),
    refetchOnMount: 'always',
  });
}

export function useConsoleProjects(orgId: string | null) {
  return useQuery({
    queryKey: queryKeys.projects(orgId ?? ''),
    queryFn: () => {
      if (!orgId) {
        throw new Error('orgId is required');
      }
      return fetcher<ConsoleProject[]>(`/api/orgs/${orgId}/projects`);
    },
    enabled: orgId !== null,
  });
}
