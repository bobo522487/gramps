import { LineageShell } from '@/components/lineage/lineage-shell';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getNavFolders, getNavLineages } from '@/lib/lineage/nav';

export default async function LineagesLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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
    <LineageShell
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
        surname: lineage.surname,
        hallCode: lineage.hallCode,
        nodeCount: lineage.nodeCount,
        folderId: lineage.folderId,
      }))}
      canWrite={hasPermission(role, 'lineage.write')}
      canManageFolders={hasPermission(role, 'project.write')}
    >
      {children}
    </LineageShell>
  );
}
