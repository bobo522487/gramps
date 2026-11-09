import { notFound } from 'next/navigation';
import { LineageDetail } from '@/components/lineage/lineage-detail';
import { toFolderOption, toNodeViews } from '@/components/lineage/types';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getLineageById } from '@/lib/db/queries/lineages';
import { getNodes } from '@/lib/db/queries/nodes';
import { isUuid } from '@/lib/ids';
import { getNavFolders } from '@/lib/lineage/nav';

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
    getNavFolders(user.id, organization.id, project.id),
  ]);

  return (
    <LineageDetail
      orgId={organization.id}
      lineage={{
        id: lineage.id,
        name: lineage.name,
        // Target-model `lineage` retired these columns (appendix A.4). The
        // detail view still declares them, so feed it neutral values here;
        // `nodeCount` is recomputed from the projected rows inside the view.
        surname: '',
        hallCode: null,
        region: null,
        notes: lineage.description,
        generationWords: null,
        nodeCount: 0,
        folderId: lineage.folderId,
      }}
      nodes={toNodeViews(nodes)}
      folders={folders.map(toFolderOption)}
      canWrite={hasPermission(role, 'lineage.write')}
    />
  );
}
