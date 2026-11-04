'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { useRef, useState } from 'react';

import { articleImageNode } from '@/components/article/editor/article-image-node';
import { uploadArticleImage } from '@/components/article/editor/image-upload';
import {
  Separator,
  ToggleButton,
} from '@/components/article/editor/toolbar-primitives';
import {
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_LABELS,
  ARTICLE_FONT_SIZES,
  ARTICLE_IMAGE_WIDTHS,
  MAX_IMAGES_PER_PAGE,
} from '@/lib/article/constants';

/**
 * 编辑器工具栏（FR-002、FR-007、FR-008、FR-009、FR-012、FR-018）。
 *
 * 分组（组间用分隔线）：撤销重做｜段落样式（正文 / 两级标题）｜字体字号｜
 * 加粗 / 斜体 / 下划线｜列表（无序 / 有序）｜对齐（左 / 中 / 右）｜插图与图片宽度。
 * 没有颜色、行距、表格、引用块、多级大纲、嵌套列表、任务清单、模板 / 导出 /
 * 分享入口（FR-012 硬边界）——不做就不摆出来（SC-005）。
 *
 * 003 在 002 基础上新增（FR-031 由 003 修订）：
 *  - B / I / U（FR-007）：空选区点击切换「随后输入生效」，走 TipTap 原生的
 *    stored marks，不改写当前段已有文字；工具栏用 aria-pressed 反映激活态。
 *  - 单层列表（FR-008）：StarterKit 的 listKeymap 已关闭、没有缩进控件，禁嵌套。
 *  - 段落 / 标题对齐（FR-009）：仅 left / center / right，justify 不在开放范围。
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

  // useEditor 默认不在事务后重渲染，B/I/U/列表/对齐的激活态必须靠 useEditorState
  // 才能跟随选区变化（FR-007、FR-008、FR-009）。
  const ui = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const style = instance.getAttributes('textStyle') as Record<
        string,
        unknown
      >;
      const imageAttrs = instance.getAttributes('articleImage') as Record<
        string,
        unknown
      >;
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        underline: instance.isActive('underline'),
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        alignLeft: instance.isActive({ textAlign: 'left' }),
        alignCenter: instance.isActive({ textAlign: 'center' }),
        alignRight: instance.isActive({ textAlign: 'right' }),
        heading: instance.isActive('heading'),
        h1: instance.isActive('heading', { level: 1 }),
        h2: instance.isActive('heading', { level: 2 }),
        image: instance.isActive('articleImage'),
        imageWidth: imageAttrs.width,
        fontFamily:
          typeof style.fontFamily === 'string' ? style.fontFamily : '',
        fontSize: typeof style.fontSize === 'string' ? style.fontSize : '',
        canUndo: instance.can().undo(),
        canRedo: instance.can().redo(),
      };
    },
  });

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
    <div
      role="toolbar"
      aria-label="格式工具栏"
      className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-xs"
    >
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
        disabled={disabled || !ui.canUndo}
        className="rounded px-2 py-1 hover:bg-muted disabled:opacity-40"
        onClick={() => editor.chain().focus().undo().run()}
      >
        撤销
      </button>
      <button
        type="button"
        aria-label="重做"
        disabled={disabled || !ui.canRedo}
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

      <Separator />

      <ToggleButton
        label="正文"
        active={!ui.heading}
        disabled={disabled}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        正文
      </ToggleButton>
      <ToggleButton
        label="一级标题"
        active={ui.h1}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        标题
      </ToggleButton>
      <ToggleButton
        label="二级标题"
        active={ui.h2}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        小标题
      </ToggleButton>

      <Separator />

      <label className="sr-only" htmlFor="article-font-family">
        字体
      </label>
      <select
        id="article-font-family"
        disabled={disabled}
        className="rounded border border-border bg-background px-1 py-0.5"
        value={ui.fontFamily}
        onChange={(event) => {
          const family = event.target.value || null;
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
        value={ui.fontSize}
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

      <Separator />

      <ToggleButton
        label="加粗"
        active={ui.bold}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        加粗
      </ToggleButton>
      <ToggleButton
        label="斜体"
        active={ui.italic}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        斜体
      </ToggleButton>
      <ToggleButton
        label="下划线"
        active={ui.underline}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        下划线
      </ToggleButton>

      <Separator />

      <ToggleButton
        label="无序列表"
        active={ui.bulletList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        列表
      </ToggleButton>
      <ToggleButton
        label="有序列表"
        active={ui.orderedList}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        编号
      </ToggleButton>

      <Separator />

      <ToggleButton
        label="左对齐"
        active={ui.alignLeft}
        disabled={disabled}
        onClick={() => editor.chain().focus().setArticleTextAlign('left').run()}
      >
        左
      </ToggleButton>
      <ToggleButton
        label="居中"
        active={ui.alignCenter}
        disabled={disabled}
        onClick={() =>
          editor.chain().focus().setArticleTextAlign('center').run()
        }
      >
        中
      </ToggleButton>
      <ToggleButton
        label="右对齐"
        active={ui.alignRight}
        disabled={disabled}
        onClick={() =>
          editor.chain().focus().setArticleTextAlign('right').run()
        }
      >
        右
      </ToggleButton>

      {ui.image ? (
        <>
          <Separator />
          {ARTICLE_IMAGE_WIDTHS.map((width) => (
            <button
              key={width}
              type="button"
              aria-label={`图片宽度${WIDTH_LABEL[width] ?? width}`}
              disabled={disabled}
              className={`rounded px-2 py-1 ${ui.imageWidth === width ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
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
