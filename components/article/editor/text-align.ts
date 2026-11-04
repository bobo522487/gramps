/**
 * 段落对齐扩展（FR-009）。
 *
 * TipTap 3 的 StarterKit 不含 TextAlign，而本机 pnpm store 只读、无法
 * `pnpm add @tiptap/extension-text-align`，所以这里用已安装好的 `@tiptap/core`
 * 写一个**等价本地实现**：对齐只作用在 `paragraph` / `heading(1|2)` 的块级
 * `textAlign` 属性上（FR-031 边界——不能塞进 font/textStyle 那种行内 mark）。
 * 文件落在 `components/article/editor/**`，仍满足 ADR 0010「编辑器依赖只在
 * lib/article 与 components/article/editor 内、且必须有消费者」。
 *
 * 与官方扩展的契约一致：`setArticleTextAlign` / `unsetArticleTextAlign` 两个命令
 * （加 `article` 前缀避免与未来官方扩展撞名），对齐值来自
 * `ARTICLE_TEXT_ALIGNMENTS`（FR-009 只开放 left / center / right；justify 不在本期）。
 */

import { type CommandProps, Extension } from '@tiptap/core';

import {
  ARTICLE_TEXT_ALIGNMENTS,
  type ArticleTextAlignment,
} from '@/lib/article/constants';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    articleTextAlign: {
      setArticleTextAlign: (alignment: ArticleTextAlignment) => ReturnType;
      unsetArticleTextAlign: () => ReturnType;
    };
  }
}

export const articleTextAlign = Extension.create({
  name: 'articleTextAlign',

  addOptions() {
    return {
      types: ['heading', 'paragraph'] as const,
      alignments: ARTICLE_TEXT_ALIGNMENTS,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types as unknown as string[],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) =>
              (element.style.textAlign as ArticleTextAlignment) || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const align = attributes.textAlign as
                | ArticleTextAlignment
                | undefined;
              if (!align) {
                return {};
              }
              return { style: `text-align: ${align}` };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    // 直接走 tr.setNodeMarkup：把选中范围内所有 paragraph / heading 都打上
    // textAlign，其余节点（列表项、图片、文本）不动。与 TipTap 自带
    // updateAttributes 命令同构：mutate tr、dispatch 存在时才落地、返回
    // changed 让 CommandManager 决定要不要派发。空选区时 nodesBetween 仍会
    // 访问光标所在的块级节点，所以「把光标所在段落居中」也成立（FR-009）。
    // 不用 commands.updateAttributes 链式 .every(...) 写法——它在第一个不在
    // 选区内的类型上返回 false 时会短路，导致段落对齐被漏掉。
    const alignInSelection =
      (alignment: ArticleTextAlignment | null) =>
      ({ state, tr, dispatch }: CommandProps): boolean => {
        if (
          alignment !== null &&
          !this.options.alignments.includes(alignment)
        ) {
          return false;
        }
        const typeNames = new Set<string>(this.options.types);
        let changed = false;
        tr.selection.ranges.forEach((range) => {
          const from = range.$from.pos;
          const to = range.$to.pos;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (!typeNames.has(node.type.name)) {
              return;
            }
            changed = true;
            if (dispatch) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                textAlign: alignment,
              });
            }
          });
        });
        return changed;
      };

    return {
      setArticleTextAlign: (alignment: ArticleTextAlignment) =>
        alignInSelection(alignment),
      unsetArticleTextAlign: () => alignInSelection(null),
    };
  },
});
