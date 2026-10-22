import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { ConsoleFrame } from '@/components/console/console-frame';
import { requireOrgContext } from '@/lib/auth/context';
import { getProjects } from '@/lib/db/queries/projects';
import { queryKeys } from '@/lib/query-keys';

export default async function OrgWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const projects = await getProjects(context.user.id, context.organization.id);
  const projectFallback = projects.map((project) => ({
    id: project.id,
    name: project.name,
    ref: project.ref,
  }));

  const queryClient = new QueryClient();
  queryClient.setQueryData(
    queryKeys.projects(context.organization.id),
    projectFallback
  );
  const initialState = dehydrate(queryClient);

  return (
    <HydrationBoundary state={initialState}>
      <ConsoleFrame
        scope={{
          org: {
            id: context.organization.id,
            name: context.organization.name,
            slug: context.organization.slug,
            role: context.role,
          },
        }}
      >
        {children}
      </ConsoleFrame>
    </HydrationBoundary>
  );
}
