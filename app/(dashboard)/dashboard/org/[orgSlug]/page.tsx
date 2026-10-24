import type { ProjectView } from '@/components/project/project-workspace';
import { ProjectWorkspace } from '@/components/project/project-workspace';
import { requireOrgContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getProjects } from '@/lib/db/queries/projects';

export default async function OrgProjectsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const context = await requireOrgContext(orgSlug);
  const projects = await getProjects(context.user.id, context.organization.id);
  const views: ProjectView[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    ref: project.ref,
    themeName: project.themeName,
    surname: project.surname,
    hallCode: project.hallCode,
    countriesRegions: project.countriesRegions,
    createdAt: project.createdAt.toISOString().slice(0, 10),
    createdAtIso: project.createdAt.toISOString(),
  }));

  return (
    <ProjectWorkspace
      orgId={context.organization.id}
      projects={views}
      canManage={hasPermission(context.role, 'project.write')}
    />
  );
}
