import { z } from 'zod';

import {
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
  ARTICLE_IMAGE_WIDTHS,
  ARTICLE_SCHEMA_VERSION,
  ARTICLE_TEXT_ALIGNMENTS,
  ARTICLE_TITLE_MAX_LENGTH,
  ARTICLE_TITLE_MIN_LENGTH,
  DEFAULT_ARTICLE_IMAGE_WIDTH,
  MAX_IMAGES_PER_PAGE,
  MAX_PAGES_PER_ARTICLE,
} from '@/lib/article/constants';
import { eachImageAttrs, mediaPathPrefix } from '@/lib/article/doc';

/**
 * 谱文文档的白名单校验（data-model.md §2 的 9 条不变量在这里，别处不再实现一遍）。
 *
 * 服务端权威：客户端会先做同样的预校验，但落库前一定走这里。
 */

const textStyleMarkSchema = z.object({
  type: z.literal('textStyle'),
  attrs: z
    .object({
      // `.nullish()` 而不是 `.optional()`：ProseMirror 的 `Mark.toJSON()`
      // 会把没设的那一项写成 null，Action 的 Zod 在清洗之前就跑到，
      // 只认 undefined 会让「设了字体」这一页直接保存失败（FR-030）。
      fontFamily: z.enum(ARTICLE_FONT_FAMILIES).nullish(),
      fontSize: z.enum(ARTICLE_FONT_SIZES).nullish(),
    })
    .optional(),
});

/** 无属性内联标记：加粗 / 斜体 / 下划线（FR-012，003 放开）。 */
const simpleMarkSchema = z.object({
  type: z.enum(['bold', 'italic', 'underline']),
});

const textNodeSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  marks: z.array(z.union([textStyleMarkSchema, simpleMarkSchema])).optional(),
});

const headingNodeSchema = z.object({
  type: z.literal('heading'),
  attrs: z.object({
    level: z.union([z.literal(1), z.literal(2)]),
    // 段落对齐（FR-009）：可作用在标题上（FR-031 边界）。
    textAlign: z.enum(ARTICLE_TEXT_ALIGNMENTS).nullish(),
  }),
  content: z.array(textNodeSchema).optional(),
});

const paragraphNodeSchema = z.object({
  type: z.literal('paragraph'),
  // 段落对齐（FR-009）：默认不写，跟随纸张容器。
  attrs: z
    .object({
      textAlign: z.enum(ARTICLE_TEXT_ALIGNMENTS).nullish(),
    })
    .optional(),
  content: z.array(textNodeSchema).optional(),
});

const imageNodeSchema = z.object({
  type: z.literal('articleImage'),
  attrs: z.object({
    pathname: z.string().min(1),
    width: z
      .enum(ARTICLE_IMAGE_WIDTHS)
      .optional()
      .transform((value) => value ?? DEFAULT_ARTICLE_IMAGE_WIDTH),
  }),
});

/**
 * 列表项（FR-012）：单级。`listItem` 里不能再有列表（嵌套列表由 doc.ts
 * 在落库前压平，保持文字不丢），所以这里把子内容限制为段落 / 标题 / 图片，
 * 不再允许嵌套的 bulletList / orderedList（防御第二道，FR-031 边界）。
 */
const listItemNodeSchema = z.lazy(() =>
  z.object({
    type: z.literal('listItem'),
    content: z
      .array(z.union([paragraphNodeSchema, headingNodeSchema, imageNodeSchema]))
      .optional(),
  })
);

const bulletListNodeSchema = z.object({
  type: z.literal('bulletList'),
  content: z.array(listItemNodeSchema).optional(),
});

const orderedListNodeSchema = z.object({
  type: z.literal('orderedList'),
  content: z.array(listItemNodeSchema).optional(),
});

/**
 * 一页的正文文档：只允许 doc / paragraph / heading(1|2) / text / articleImage /
 * bulletList / orderedList / listItem 节点，且 doc 顶层只挂块级节点
 * （`text` 只能出现在段落与标题里）。mark 允许 `textStyle` 的字体字号，以及
 * 加粗 / 斜体 / 下划线（FR-012，003 放开；FR-031 仍禁止颜色 / 行高 / 表格 /
 * 引用 / 链接 / 嵌套列表）（data-model.md §2 不变量 5）。
 */
export const articlePageDocSchema = z.object({
  type: z.literal('doc'),
  content: z
    .array(
      z.union([
        headingNodeSchema,
        paragraphNodeSchema,
        imageNodeSchema,
        bulletListNodeSchema,
        orderedListNodeSchema,
      ])
    )
    .optional(),
});

const articlePageSchema = z.object({
  id: z.string().min(1),
  doc: articlePageDocSchema,
});

const titleSchema = z
  .string()
  .trim()
  .min(ARTICLE_TITLE_MIN_LENGTH, '请填写谱文标题')
  .max(ARTICLE_TITLE_MAX_LENGTH, `标题最多 ${ARTICLE_TITLE_MAX_LENGTH} 个字`);

export { titleSchema as articleTitleSchema };

/**
 * 整篇分页文档包。`orgId` / `articleId` 决定图片 pathname 的合法前缀：
 * 谱文只能引用自己名下的图片，防止把别的谱文或别的组织的文件挂进正文（FR-035）。
 */
export function articleContentSchema(scope: {
  orgId: string;
  articleId: string;
}) {
  const prefix = mediaPathPrefix(scope.orgId, scope.articleId);

  return z
    .object({
      schemaVersion: z.literal(ARTICLE_SCHEMA_VERSION),
      pages: z
        .array(articlePageSchema)
        .min(1, '至少要有一页')
        .max(MAX_PAGES_PER_ARTICLE, `一篇谱文最多 ${MAX_PAGES_PER_ARTICLE} 页`),
    })
    .superRefine((content, ctx) => {
      const seen = new Set<string>();
      content.pages.forEach((page, index) => {
        if (seen.has(page.id)) {
          ctx.addIssue({
            code: 'custom',
            path: ['pages', index, 'id'],
            message: '页标识重复',
          });
          return;
        }
        seen.add(page.id);
      });

      const imagesOnPage = new Map<string, number>();
      let hasForeignImage = false;
      eachImageAttrs(content, (attrs, pageId) => {
        imagesOnPage.set(pageId, (imagesOnPage.get(pageId) ?? 0) + 1);
        const pathname = attrs.pathname;
        if (typeof pathname !== 'string' || !pathname.startsWith(prefix)) {
          // 引用了别的谱文或别的组织的图片：拒绝整次保存（FR-035）。
          hasForeignImage = true;
        }
      });

      for (const count of imagesOnPage.values()) {
        if (count > MAX_IMAGES_PER_PAGE) {
          ctx.addIssue({
            code: 'custom',
            path: ['pages'],
            message: `每页最多 ${MAX_IMAGES_PER_PAGE} 张图片`,
          });
          break;
        }
      }

      if (hasForeignImage) {
        ctx.addIssue({
          code: 'custom',
          path: ['pages'],
          message: '图片不属于这篇谱文',
        });
      }
    });
}

/** 保存单页时的入参文档（不含分页包装）。 */
export { imageNodeSchema as articleImageNodeSchema };

/* ── Action 入参────────────────────────────────────── */

const uuidArg = z.uuid('参数无效');
const pageIdArg = z.string().min(1, '页标识无效');

export const createArticleSchema = z.object({
  orgId: uuidArg,
  projectId: uuidArg,
  title: titleSchema,
  folderId: z.nullable(uuidArg).optional(),
});

export const updateArticleTitleSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
  title: titleSchema,
});

export const moveArticleSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
  folderId: z.nullable(uuidArg),
});

export const deleteArticleSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
});

export const saveArticlePageSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
  pageId: pageIdArg,
  doc: articlePageDocSchema,
});

export const addArticlePageSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
});

export const deleteArticlePageSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
  pageId: pageIdArg,
});

export const reorderArticlePagesSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
  pageIds: z.array(pageIdArg).min(1, '页顺序不能为空'),
});

/**
 * 删除确认框的预览读取入参。
 *
 * 这两个是**只读**通道：确认框要在用户点「删除」之前给出页数、图片数与
 * 「是否被谱书编目引用」，而这些数字只有服务端算得准（软删语义、跨表引用）。
 */
export const previewArticleSchema = z.object({
  orgId: uuidArg,
  articleId: uuidArg,
});

export const previewFolderSchema = z.object({
  orgId: uuidArg,
  folderId: uuidArg,
});
