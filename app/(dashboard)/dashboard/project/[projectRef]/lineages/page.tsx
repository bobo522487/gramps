import { LineageWorkspace } from '@/components/lineage/lineage-workspace';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getNavFolders, getNavLineages } from '@/lib/lineage/nav';

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export default async function ProjectLineagesPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const { user, project, organization, role } =
    await requireProjectContext(projectRef);

  const [folders, lineages] = await Promise.all([
    getNavFolders(user.id, organization.id, project.id),
    getNavLineages(user.id, organization.id, project.id),
  ]);

  return (
    <LineageWorkspace
      orgId={organization.id}
      projectId={project.id}
      projectRef={project.ref}
      projectThemeName={project.themeName ?? ''}
      projectSurname={project.surname ?? ''}
      projectRegion={project.countriesRegions ?? ''}
      canProjectWrite={hasPermission(role, 'project.write')}
      folders={folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      }))}
      lineages={lineages.map((lineage) => ({
        id: lineage.id,
        name: lineage.name,
        // Neutral values for the columns retired by the target model (A.4);
        // the workspace still renders them as part of its stable UI contract.
        surname: '',
        hallCode: null,
        region: null,
        notes: lineage.description,
        generationWords: null,
        nodeCount: 0,
        folderId: lineage.folderId,
        createdAt: formatDate(lineage.createdAt),
      }))}
      canWrite={hasPermission(role, 'lineage.write')}
    />
  );
}
