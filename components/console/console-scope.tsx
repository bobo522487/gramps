'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext } from 'react';
import { fetcher } from '@/lib/fetcher';
import { queryKeys } from '@/lib/query-keys';

export type ConsoleScope = {
  org: {
    id: string;
    name: string;
    slug: string;
    role: string;
    /** 组织目录里「云谱空间」旁的数量。只在组织页注入。 */
    projectCount?: number;
    /** 组织目录里「团队」旁的数量。只在组织页注入。 */
    memberCount?: number;
  };
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
