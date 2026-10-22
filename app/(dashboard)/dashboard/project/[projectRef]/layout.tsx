import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from '@tanstack/react-query';
import { ConsoleFrame } from '@/components/console/console-frame';
import { requireProjectContext } from '@/lib/auth/context';
import { getProjects } from '@/lib/db/queries/projects';
import { queryKeys } from '@/lib/query-keys';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const context = await requireProjectContext(projectRef);
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
          project: {
            id: context.project.id,
            name: context.project.name,
            ref: context.project.ref,
          },
        }}
      >
        {children}
      </ConsoleFrame>
    </HydrationBoundary>
  );
}
