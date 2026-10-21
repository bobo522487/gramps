import { notFound } from 'next/navigation';
import { LineageDetail } from '@/components/lineage/lineage-detail';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getFolders } from '@/lib/db/queries/folders';
import { getLineageById } from '@/lib/db/queries/lineages';
import { getNodes } from '@/lib/db/queries/nodes';
import { isUuid } from '@/lib/ids';

export default async function LineageDetailPage({
  params,
}: {
  params: Promise<{ projectRef: string; lineageId: string }>;
}) {
  const { projectRef, lineageId } = await params;
  if (!isUuid(lineageId)) {
    notFound();
  }
  const { user, project, organization, role } =
    await requireProjectContext(projectRef);

  const lineage = await getLineageById(user.id, organization.id, lineageId);
  if (!lineage || lineage.projectId !== project.id) {
    notFound();
  }

  const [nodes, folders] = await Promise.all([
    getNodes(user.id, organization.id, lineage.id),
    getFolders(user.id, organization.id, project.id, 0),
  ]);

  return (
    <LineageDetail
      orgId={organization.id}
      projectRef={project.ref}
      lineage={{
        id: lineage.id,
        name: lineage.name,
        surname: lineage.surname,
        hallCode: lineage.hallCode,
        generationWords: lineage.generationWords,
        nodeCount: lineage.nodeCount,
        folderId: lineage.folderId,
      }}
      nodes={nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        spouseOfId: node.spouseOfId,
        role: node.role,
        depth: node.depth,
        generation: node.generation,
        sort: node.sort,
        name: node.name,
        surname: node.surname,
        fullName: node.fullName,
        sex: node.sex,
        courtesy: node.courtesy,
        namePrefix: node.namePrefix,
        isAlive: node.isAlive,
        birthText: node.birthText,
        deathText: node.deathText,
        birthYear: node.birthYear,
        deathYear: node.deathYear,
        burialPlace: node.burialPlace,
        biography: node.biography,
      }))}
      folders={folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      }))}
      canWrite={hasPermission(role, 'lineage.write')}
    />
  );
}
