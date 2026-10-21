import type { ProjectView } from '@/components/project/project-workspace';
import { ProjectWorkspace } from '@/components/project/project-workspace';
import { requireOrgContext } from '@/lib/auth/context';
import { getProjects } from '@/lib/db/queries/projects';

export default async function OrgProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const projects = await getProjects(context.organization.id);
  const views: ProjectView[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    ref: project.ref,
    region: project.region,
    status: project.status,
    health: project.health,
    createdAt: project.createdAt.toISOString().slice(0, 10),
    createdAtIso: project.createdAt.toISOString(),
  }));

  return (
    <ProjectWorkspace
      orgId={context.organization.id}
      projects={views}
      isOwner={context.role === 'owner'}
    />
  );
}
