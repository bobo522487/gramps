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
      defaultSurname={project.primarySurname}
      folders={folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      }))}
      lineages={lineages.map((lineage) => ({
        id: lineage.id,
        name: lineage.name,
        surname: lineage.surname,
        hallCode: lineage.hallCode,
        generationWords: lineage.generationWords,
        nodeCount: lineage.nodeCount,
        folderId: lineage.folderId,
        createdAt: formatDate(lineage.createdAt),
      }))}
      canWrite={hasPermission(role, 'lineage.write')}
    />
  );
}
