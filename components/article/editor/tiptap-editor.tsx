'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef } from 'react';
import { articleImage } from '@/components/article/editor/article-image-node';
import { sanitizePasteHtml } from '@/components/article/editor/paste-filter';
import { articleTextAlign } from '@/components/article/editor/text-align';
import {
  articleFontFamily,
  articleFontSize,
  articleTextStyle,
} from '@/components/article/editor/text-style';
import { EditorToolbar } from '@/components/article/editor/toolbar';
import {
  type ArticlePageDoc,
  normalizePageDoc,
  pageHasImage,
  pagePlainText,
} from '@/lib/article/doc';

/**
 * 谱文正文编辑器（FR-001、FR-009、FR-012..FR-014、FR-018、FR-025..FR-031；
 * FR-031 由 003 修订）。
 *
 * 003 放开加粗 / 斜体 / 下划线 / 单级列表与段落对齐：
 *  - StarterKit 默认就带 B/I/U 与单级列表，直接去掉 FR-031 时的 `false` 开关
 *    即可（其选项类型只允许 `false | Partial<Options>`，不收显式 `true`）；
 *    `listKeymap:false` 关掉 Tab/Shift+Tab 的 sink/lift，禁嵌套列表。
 *  - 引用 / 代码 / 表格 / 链接 / 删除线 / 分隔线仍关闭（FR-012 硬边界）。
 *  - 对齐用等价本地扩展 `articleTextAlign`（paragraph / heading(1|2) 的块级属性）。
 *  - 粘贴先过 `sanitizePasteHtml`（三级标题降级、外链图与颜色剥掉、嵌套列表压平），
 *    再由 schema + doc.ts 落库前兜第二道（FR-013、FR-012）。
 *  - 查看者（editable=false）**不渲染**工具栏，不是禁用后仍可见（FR-018、SC-006）。
 *  - 浅色桌面 + 白色纸面用 app/globals.css 的 .article-desk / .article-paper，
 *    颜色只用 @theme token（FR-001、FR-004），不引入第三方主题包。
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
        // FR-012：放开加粗 / 斜体 / 下划线 / 单级列表。
        // StarterKit 默认就带这些扩展，FR-031 时把它们设成 `false` 关掉；
        // 003 重新放开——直接去掉 `false` 即可（StarterKit 的选项类型只允许
        // `false` 或 `Partial<Options>`，不允许显式 `true`）。
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        // FR-031 边界：禁止嵌套列表——关掉 Tab/Shift+Tab 的 sink/lift 键位，
        // 嵌套只能靠粘贴带进来，再由 doc.ts 在落库前压平（保留文字）。
        listKeymap: false,
        horizontalRule: false,
        hardBreak: false,
        link: false,
      }),
      // FR-009：段落对齐，等价本地实现（见 text-align.ts 注释）。
      articleTextAlign,
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
        class: 'article-canvas focus:outline-none',
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

  // 空白页要给引导（FR-018）。用覆盖层而不是 Placeholder 扩展：
  // Placeholder 会往文档里塞装饰节点，中文输入法组合期会被它打断。
  const showGuidance =
    editable && pagePlainText(value).trim() === '' && !pageHasImage(value);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* FR-018 / SC-006：查看者不渲染工具栏（不是禁用后仍可见）。 */}
      {editable ? (
        <EditorToolbar
          editor={editor}
          orgId={orgId}
          articleId={articleId}
          mediaMode={mediaMode}
          disabled={false}
          onNotice={onNotice}
        />
      ) : null}
      {/* FR-001：浅色桌面 + 接近 A4 宽的白色纸面，水平居中、非全屏。 */}
      <div className="article-desk relative min-h-0 flex-1 overflow-y-auto">
        <div className="article-paper relative">
          {showGuidance ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute text-muted-foreground"
            >
              输入文字
            </span>
          ) : null}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
