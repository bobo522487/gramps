import { notFound } from 'next/navigation';
import type { ProjectView } from '@/components/project/project-workspace';
import { ProjectWorkspace } from '@/components/project/project-workspace';
import { getOrgWithRoleBySlug, getProjects, getUser } from '@/lib/db/queries';

export default async function OrgProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const user = await getUser();
  if (!user) {
    notFound();
  }

  const scope = await getOrgWithRoleBySlug(user.id, orgSlug);
  if (!scope) {
    notFound();
  }

  const projects = await getProjects(scope.organization.id);
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
      orgId={scope.organization.id}
      projects={views}
      isOwner={scope.role === 'owner'}
    />
  );
}
