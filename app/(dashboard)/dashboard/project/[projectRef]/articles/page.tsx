import { FileText } from 'lucide-react';
import { ArticleWorkspace } from '@/components/article/article-workspace';
import {
  type ArticleFolderNode,
  type ArticleRow,
  folderPickerOptions,
} from '@/components/article/types';
import { PageHeader } from '@/components/console/page-header';
import {
  getNavArticleCounts,
  getNavArticleFolders,
  getNavArticleList,
} from '@/lib/article/nav';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';

export default async function ProjectArticlesPage({
  params,
}: {
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  const { user, project, organization, role } =
    await requireProjectContext(projectRef);

  const [folders, list, counts] = await Promise.all([
    getNavArticleFolders(user.id, organization.id, project.id),
    getNavArticleList(user.id, organization.id, project.id),
    getNavArticleCounts(user.id, organization.id, project.id),
  ]);

  const folderNodes: ArticleFolderNode[] = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    count: counts.byFolder.get(folder.id) ?? 0,
  }));

  const rows: ArticleRow[] = list.map((article) => ({
    id: article.id,
    title: article.title,
    folderId: article.folderId,
    pageCount: article.pageCount,
    lastTouchedAt: (article.updatedAt ?? article.createdAt)
      .toISOString()
      .slice(0, 10),
  }));

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 p-4 lg:p-6">
      <PageHeader
        icon={FileText}
        title="谱文"
        description={`收录「${project.name}」的谱序、传记与其他文字记录。`}
      />
      <ArticleWorkspace
        orgId={organization.id}
        projectId={project.id}
        projectRef={projectRef}
        projectRegion={project.countriesRegions ?? '中国'}
        canWrite={hasPermission(role, 'article.write')}
        canManageFolders={hasPermission(role, 'project.write')}
        folders={folderNodes}
        unfiledCount={counts.unfiled}
        rows={rows}
        folderOptions={folderPickerOptions(folderNodes)}
      />
    </section>
  );
}
