'use client';

import { createContext, type ReactNode, useContext } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/fetcher';

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
  return useSWR<ConsoleOrg[]>('/api/orgs', fetcher);
}

export function useConsoleProjects(orgId: string | null) {
  return useSWR<ConsoleProject[]>(
    orgId ? `/api/orgs/${orgId}/projects` : null,
    fetcher
  );
}
