import { notFound } from 'next/navigation';
import { ArticleEditorShell } from '@/components/article/article-editor-shell';
import {
  type ArticleFolderNode,
  folderPickerOptions,
} from '@/components/article/types';
import { parseArticleContent } from '@/lib/article/doc';
import { getMediaStore } from '@/lib/article/media/store';
import { getNavArticleCounts, getNavArticleFolders } from '@/lib/article/nav';
import { requireProjectContext } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { getArticle } from '@/lib/db/queries/articles';

/**
 * 谱文编辑器页（FR-012）。
 *
 * RSC 只负责**首次挂载**把服务端快照交给编辑器；此后客户端自己接管，
 * 保存/加删页都不再整页失效：否则服务端快照会在敲字间隙
 * 被推回编辑器，覆盖未保存内容，违反 FR-017。
 */

export default async function ArticleEditorPage({
  params,
}: {
  params: Promise<{ projectRef: string; articleId: string }>;
}) {
  const { projectRef, articleId } = await params;
  const { user, project, organization, role } =
    await requireProjectContext(projectRef);

  const article = await getArticle(user.id, organization.id, articleId);
  if (!article || article.projectId !== project.id) {
    notFound();
  }

  const [folders, counts] = await Promise.all([
    getNavArticleFolders(user.id, organization.id, project.id),
    getNavArticleCounts(user.id, organization.id, project.id),
  ]);

  const folderNodes: ArticleFolderNode[] = folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    count: counts.byFolder.get(folder.id) ?? 0,
  }));

  return (
    <ArticleEditorShell
      mediaMode={getMediaStore().mode}
      orgId={organization.id}
      projectId={project.id}
      projectRef={projectRef}
      articleId={article.id}
      initialTitle={article.title}
      projectRegion={project.countriesRegions ?? '中国'}
      canWrite={hasPermission(role, 'article.write')}
      canManageFolders={hasPermission(role, 'project.write')}
      initial={parseArticleContent(article.content)}
      folders={folderNodes}
      unfiledCount={counts.unfiled}
      folderOptions={folderPickerOptions(folderNodes)}
    />
  );
}
