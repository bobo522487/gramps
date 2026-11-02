'use client';

import { FileText, MoreVertical, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { EmptyState } from '@/components/console/empty-state';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  ArticleDeleteDialog,
  ArticleMoveDialog,
  ArticleRenameDialog,
} from './article-card-dialogs';
import type { ArticleRow, FolderPickerOption } from './types';
import { folderLabel } from './types';

/**
 * 谱文列表（FR-002、FR-003、FR-006、FR-008、FR-010、FR-011）。
 *
 * 列表一次性全量下发、不分页（research §13：单项目按 ≤200 篇设计），
 * 标题搜索就在这一份数据上前端过滤（FR-007、FR-032）：数据已经全量在手，
 * 再造一次服务端查询是第二套过滤逻辑。按正文检索是后置项（FR-044），
 * 那时才需要服务端 `plain_text` + `pg_trgm` 的查询入口。
 */

export function ArticleList({
  orgId,
  projectRef,
  rows,
  folderOptions,
  canWrite,
}: {
  orgId: string;
  projectRef: string;
  rows: ArticleRow[];
  folderOptions: FolderPickerOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [renaming, setRenaming] = useState<ArticleRow | null>(null);
  const [moving, setMoving] = useState<ArticleRow | null>(null);
  const [deleting, setDeleting] = useState<ArticleRow | null>(null);

  const visible = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) {
      return rows;
    }
    return rows.filter((row) => row.title.toLowerCase().includes(needle));
  }, [rows, keyword]);

  function refresh() {
    setRenaming(null);
    setMoving(null);
    setDeleting(null);
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3 py-2">
        <Input
          id="article-search"
          value={keyword}
          placeholder="搜索标题"
          aria-label="搜索谱文标题"
          onChange={(event) => setKeyword(event.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={rows.length === 0 ? '还没有谱文' : '没有匹配的谱文'}
            description={
              rows.length === 0
                ? '从「新建谱文」开始，写下谱序、传记或凡例。'
                : '换个关键词试试，或清空搜索框看全部。'
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((row) => (
              <li key={row.id} className="group flex items-center gap-2 py-2">
                <Link
                  href={`/dashboard/project/${projectRef}/articles/${row.id}`}
                  className="min-w-0 flex-1 truncate text-sm hover:underline"
                >
                  {row.title}
                </Link>
                {/* FR-032：命中结果要能看出所属分类，跨分类找文才不费劲。 */}
                <Badge variant="outline" className="shrink-0 text-xs">
                  {folderLabel(folderOptions, row.folderId)}
                </Badge>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.pageCount} 页
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {row.lastTouchedAt}
                </span>
                {canWrite ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label={`「${row.title}」的操作`}
                        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                      >
                        <MoreVertical size={14} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" size="sm">
                      <DropdownMenuItem onSelect={() => setRenaming(row)}>
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setMoving(row)}>
                        移到分类
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDeleting(row)}
                      >
                        <Trash2 size={12} /> 删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <ArticleRenameDialog
        orgId={orgId}
        row={renaming}
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRenaming(null);
          }
        }}
        onSaved={refresh}
      />
      <ArticleMoveDialog
        orgId={orgId}
        row={moving}
        folders={folderOptions}
        open={moving !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMoving(null);
          }
        }}
        onSaved={refresh}
      />
      <ArticleDeleteDialog
        orgId={orgId}
        row={deleting}
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
          }
        }}
        onDeleted={refresh}
      />
    </div>
  );
}
