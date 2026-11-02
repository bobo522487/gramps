'use client';

import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import {
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_LABELS,
  ARTICLE_FONT_SIZES,
  ARTICLE_IMAGE_WIDTHS,
} from '@/lib/article/constants';
import type { ArticlePageDoc } from '@/lib/article/doc';

/**
 * 谱文正文编辑器（FR-012..FR-014、FR-025..FR-031）。
 *
 * 节点白名单就是规格的那五种：doc / paragraph / heading(1|2) / text /
 * articleImage。**加粗、斜体、列表、引用、表格、代码、链接一律不做**
 * （FR-031），所以直接从 StarterKit 里关掉，而不是「留着但不显示」——
 * 留着就会被快捷键触发，用户会做出存不住的格式。
 *
 * 字号与字体（FR-030，P2）走 `textStyle` mark，取值受 `lib/article/schemas.ts`
 * 的白名单约束；浏览器没有对应字体时按系统回退显示，不报错。
 */

const FONT_LABEL = new Map<string, string>(
  ARTICLE_FONT_FAMILIES.map((family) => [
    family,
    ARTICLE_FONT_LABELS[family] ?? family,
  ])
);

const WIDTH_LABEL: Record<string, string> = {
  small: '小',
  medium: '中',
  full: '整宽',
};

const articleImage = Image.extend({
  name: 'articleImage',
  addAttributes() {
    return {
      pathname: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-pathname'),
      },
      width: {
        default: 'full',
        parseHTML: (el) => el.getAttribute('data-width'),
      },
    };
  },
  renderHTML({ node }) {
    const pathname = String(node.attrs.pathname ?? '');
    const width = String(node.attrs.width ?? 'full');
    return [
      'img',
      {
        src: `/api/media/${pathname}`,
        'data-pathname': pathname,
        'data-width': width,
        alt: '',
        class:
          width === 'small' ? 'w-1/3' : width === 'medium' ? 'w-2/3' : 'w-full',
      },
    ];
  },
});

export function TipTapEditor({
  pageId,
  value,
  onChange,
}: {
  pageId: string;
  value: ArticlePageDoc;
  onChange: (doc: ArticlePageDoc) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
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
      TextStyle,
      articleImage,
    ],
    content: value,
    onUpdate: ({ editor: instance }) => {
      onChange(instance.getJSON() as ArticlePageDoc);
    },
    editorProps: {
      attributes: {
        class:
          'article-canvas prose prose-neutral dark:prose-invert max-w-none focus:outline-none',
      },
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

  if (!editor) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EditorToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

export function applyFontFamily(editor: Editor, family: string | null): void {
  if (!family) {
    editor.chain().focus().unsetMark('textStyle').run();
    return;
  }
  editor.chain().focus().setMark('textStyle', { fontFamily: family }).run();
}

export function applyFontSize(editor: Editor, size: string | null): void {
  if (!size) {
    editor.chain().focus().unsetMark('textStyle').run();
    return;
  }
  editor.chain().focus().setMark('textStyle', { fontSize: size }).run();
}

function EditorToolbar({ editor }: { editor: Editor }) {
  const imageSelected = editor.isActive('articleImage');
  // 当前选区的 textStyle 取值决定下拉框显示什么；改下拉框即改选区。
  const textStyle = editor.getAttributes('textStyle') as {
    fontFamily?: string;
    fontSize?: string;
  };

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
      <button
        type="button"
        aria-label="正文"
        className={`rounded px-2 py-1 ${!editor.isActive('heading') ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        正文
      </button>
      <button
        type="button"
        aria-label="一级标题"
        className={`rounded px-2 py-1 ${editor.isActive('heading', { level: 1 }) ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        标题
      </button>
      <button
        type="button"
        aria-label="二级标题"
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
        className="rounded border border-border bg-background px-1 py-0.5"
        value={textStyle.fontFamily ?? ''}
        onChange={(event) =>
          applyFontFamily(editor, event.target.value || null)
        }
      >
        <option value="">默认字体</option>
        {ARTICLE_FONT_FAMILIES.map((family) => (
          <option key={family} value={family}>
            {FONT_LABEL.get(family) ?? family}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="article-font-size">
        字号
      </label>
      <select
        id="article-font-size"
        className="rounded border border-border bg-background px-1 py-0.5"
        value={textStyle.fontSize ?? ''}
        onChange={(event) => applyFontSize(editor, event.target.value || null)}
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
