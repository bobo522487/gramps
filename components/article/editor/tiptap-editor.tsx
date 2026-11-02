'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';

import { articleImage } from '@/components/article/editor/article-image-node';
import { sanitizePasteHtml } from '@/components/article/editor/paste-filter';
import {
  articleFontFamily,
  articleFontSize,
  articleTextStyle,
} from '@/components/article/editor/text-style';
import { EditorToolbar } from '@/components/article/editor/toolbar';
import { type ArticlePageDoc, normalizePageDoc } from '@/lib/article/doc';

/**
 * 谱文正文编辑器（FR-012..FR-014、FR-025..FR-031）。
 *
 * 节点白名单就是规格的那五种：doc / paragraph / heading(1|2) / text /
 * articleImage。**加粗、斜体、列表、引用、表格、代码、链接一律不做**
 * （FR-031），所以直接从 StarterKit 里关掉，而不是「留着但不显示」——
 * 留着就会被快捷键触发，用户会做出存不住的格式。
 *
 * 粘进来的外部内容先过 `sanitizePasteHtml`（三级以上标题降级、标记与外链图剥掉），
 * 再由 schema 兜第二道，保证「文字不丢、格式不落」（US3-AC6）。
 */

export function TipTapEditor({
  pageId,
  value,
  orgId,
  articleId,
  mediaMode,
  editable,
  onChange,
  onNotice,
}: {
  pageId: string;
  value: ArticlePageDoc;
  orgId: string;
  articleId: string;
  mediaMode: 'blob' | 'fs';
  editable: boolean;
  onChange: (doc: ArticlePageDoc) => void;
  onNotice: (message: string | null) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2] },
        bold: false,
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
      }),
      articleTextStyle,
      articleFontFamily,
      articleFontSize,
      articleImage,
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      // 空文档时 ProseMirror 的 JSON 不带 content，这里补形后再交给保存链路。
      onChange(normalizePageDoc(instance.getJSON()));
    },
    editorProps: {
      attributes: {
        class:
          'article-canvas prose prose-neutral dark:prose-invert max-w-none focus:outline-none',
      },
      transformPastedHTML: (html) => sanitizePasteHtml(html),
    },
  });

  const lastPageId = useRef(pageId);

  // 切页：把新页的文档灌进同一个编辑器实例；同一页内的改动不回灌，
  // 否则会打断输入法与撤销栈（FR-013、FR-018）。
  useEffect(() => {
    if (!editor) {
      return;
    }
    if (lastPageId.current === pageId) {
      return;
    }
    lastPageId.current = pageId;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, pageId, value]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorToolbar
        editor={editor}
        orgId={orgId}
        articleId={articleId}
        mediaMode={mediaMode}
        disabled={!editable}
        onNotice={onNotice}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
