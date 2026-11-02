'use client';

import type { Editor } from '@tiptap/react';
import { useRef, useState } from 'react';

import { articleImageNode } from '@/components/article/editor/article-image-node';
import { uploadArticleImage } from '@/components/article/editor/image-upload';
import {
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_LABELS,
  ARTICLE_FONT_SIZES,
  ARTICLE_IMAGE_WIDTHS,
  MAX_IMAGES_PER_PAGE,
} from '@/lib/article/constants';

/**
 * 编辑器工具栏（FR-012、FR-018、FR-025..FR-031）。
 *
 * 只有规格允许的四组动作：段落/两级标题、撤销重做、字体字号（P2）、
 * 插图与图片宽度。没有加粗、颜色、对齐、表格（FR-031），也没有版式与模板
 * 入口（FR-042）——不做就不摆出来，连灰按钮都不给（SC-011）。
 */

const WIDTH_LABEL: Record<string, string> = {
  small: '小',
  medium: '中',
  full: '整宽',
};

export function EditorToolbar({
  editor,
  orgId,
  articleId,
  mediaMode,
  disabled,
  onNotice,
}: {
  editor: Editor;
  orgId: string;
  articleId: string;
  mediaMode: 'blob' | 'fs';
  disabled: boolean;
  onNotice: (message: string | null) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const imageSelected = editor.isActive('articleImage');
  const textStyle = editor.getAttributes('textStyle') as {
    fontFamily?: string;
    fontSize?: string;
  };

  function imageCountOnPage(): number {
    let count = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'articleImage') {
        count += 1;
      }
    });
    return count;
  }

  async function pickFile(file: File) {
    // 客户端先挡一道给即时反馈，服务端仍是权威（FR-037）。
    if (imageCountOnPage() >= MAX_IMAGES_PER_PAGE) {
      onNotice(`一页最多 ${MAX_IMAGES_PER_PAGE} 张图片`);
      return;
    }
    setUploading(true);
    onNotice(null);
    const result = await uploadArticleImage({
      mode: mediaMode,
      orgId,
      articleId,
      file,
    });
    setUploading(false);
    if ('error' in result) {
      onNotice(result.error);
      return;
    }
    editor
      .chain()
      .focus()
      .insertContent(articleImageNode(result.pathname))
      .run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.item(0);
          event.target.value = '';
          if (file) {
            void pickFile(file);
          }
        }}
      />

      <button
        type="button"
        aria-label="撤销"
        disabled={disabled || !editor.can().undo()}
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => editor.chain().focus().undo().run()}
      >
        撤销
      </button>
      <button
        type="button"
        aria-label="重做"
        disabled={disabled || !editor.can().redo()}
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => editor.chain().focus().redo().run()}
      >
        重做
      </button>
      <button
        type="button"
        aria-label="插入图片"
        disabled={disabled || uploading}
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => fileInput.current?.click()}
      >
        {uploading ? '上传中…' : '插入图片'}
      </button>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <button
        type="button"
        aria-label="正文"
        disabled={disabled}
        className={`rounded px-2 py-1 ${!editor.isActive('heading') ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        正文
      </button>
      <button
        type="button"
        aria-label="一级标题"
        disabled={disabled}
        className={`rounded px-2 py-1 ${editor.isActive('heading', { level: 1 }) ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        标题
      </button>
      <button
        type="button"
        aria-label="二级标题"
        disabled={disabled}
        className={`rounded px-2 py-1 ${editor.isActive('heading', { level: 2 }) ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        小标题
      </button>

      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

      <label className="sr-only" htmlFor="article-font-family">
        字体
      </label>
      <select
        id="article-font-family"
        disabled={disabled}
        className="rounded border border-border bg-background px-1 py-0.5"
        value={textStyle.fontFamily ?? ''}
        onChange={(event) => {
          const family = event.target.value || null;
          // 用扩展自带的命令：清掉字体时顺带删掉空的 textStyle span，
          // 而且不会把同时设置的字号一起抹掉。
          const chain = editor.chain().focus();
          if (family) {
            chain.setFontFamily(family).run();
          } else {
            chain.unsetFontFamily().run();
          }
        }}
      >
        <option value="">默认字体</option>
        {ARTICLE_FONT_FAMILIES.map((family) => (
          <option key={family} value={family}>
            {ARTICLE_FONT_LABELS[family] ?? family}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="article-font-size">
        字号
      </label>
      <select
        id="article-font-size"
        disabled={disabled}
        className="rounded border border-border bg-background px-1 py-0.5"
        value={textStyle.fontSize ?? ''}
        onChange={(event) => {
          const size = event.target.value || null;
          const chain = editor.chain().focus();
          if (size) {
            chain.setFontSize(size).run();
          } else {
            chain.unsetFontSize().run();
          }
        }}
      >
        <option value="">默认字号</option>
        {ARTICLE_FONT_SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      {imageSelected ? (
        <>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          {ARTICLE_IMAGE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              aria-label={`图片宽度${WIDTH_LABEL[width] ?? width}`}
              disabled={disabled}
              className={`rounded px-2 py-1 ${editor.isActive('articleImage', { width }) ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .updateAttributes('articleImage', { width })
                  .run()
              }
            >
              {WIDTH_LABEL[width] ?? width}
            </button>
          ))}
          <button
            type="button"
            aria-label="移除图片"
            disabled={disabled}
            className="rounded px-2 py-1 text-destructive hover:bg-muted"
            onClick={() => editor.chain().focus().deleteSelection().run()}
          >
            移除图片
          </button>
        </>
      ) : null}
    </div>
  );
}
