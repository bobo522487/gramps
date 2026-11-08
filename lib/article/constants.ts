/**
 * 谱文（article）域的常量：上限、白名单与中文错误文案。
 *
 * 这些值是谱文域上限、白名单与中文错误文案的唯一实现处——校验、
 * 服务层与界面文案都从这里取，不要在别处再写一遍数字。
 * 错误文案口径见 `docs/contracts/README.md`（单一事实来源）。
 */

/** `article.content` 的分页文档包版本。 */
export const ARTICLE_SCHEMA_VERSION = 1;

/** 一篇谱文最多多少页（FR-021）。 */
export const MAX_PAGES_PER_ARTICLE = 100;

/** 一页最多多少张插图（FR-028）。 */
export const MAX_IMAGES_PER_PAGE = 6;

/** 单张图片字节上限（FR-025）。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 允许的图片 MIME（FR-025）。 */
export const ARTICLE_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

/** 媒体 pathname 的根前缀（ADR 0019）。 */
export const MEDIA_PATH_ROOT = 'articles';

/** 图片显示宽度三档（FR-026），默认整宽。 */
export const ARTICLE_IMAGE_WIDTHS = ['small', 'medium', 'full'] as const;
export const DEFAULT_ARTICLE_IMAGE_WIDTH = 'full';

/**
 * 字体白名单（FR-030，P2）：只用系统自带的宋/黑/楷，不嵌字体文件。
 * 值直接进 CSS `font-family`，顺序即回退顺序。
 */
export const ARTICLE_FONT_FAMILIES = ['SimSun', 'SimHei', 'KaiTi'] as const;
export const ARTICLE_FONT_LABELS: Record<
  (typeof ARTICLE_FONT_FAMILIES)[number],
  string
> = {
  SimSun: '宋体',
  SimHei: '黑体',
  KaiTi: '楷体',
};

/** 字号三档（FR-030）：小 / 常规 / 大。 */
export const ARTICLE_FONT_SIZES = ['14px', '16px', '19px'] as const;

/**
 * 段落对齐三档（FR-009：左 / 中 / 右，clarify Q「段落文字对齐（左/中/右）」，
 * plan R2 明确 `textAlign: left|center|right`）。两端对齐不在本期开放，别顺手加。
 * 默认不写（跟随纸张容器），仅作用在 paragraph / heading(1|2)（FR-009 / FR-031 边界）。
 */
export const ARTICLE_TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type ArticleTextAlignment = (typeof ARTICLE_TEXT_ALIGNMENTS)[number];

/** 标题长度上限（FR-001、FR-010）。 */
export const ARTICLE_TITLE_MIN_LENGTH = 1;
export const ARTICLE_TITLE_MAX_LENGTH = 60;

/** 未分类的展示名（FR-002、FR-005）。 */
export const UNFILED_ARTICLE_FOLDER_NAME = '未分类';
/** 没选分类时，服务端在同一事务里确保它存在（FR-001）。 */
export const DEFAULT_ARTICLE_FOLDER_NAME = '默认分类';

/**
 * 服务端返回给界面的稳定错误码（全小写）与中文文案。
 * 文案面向业务用户，不回显 SQL/堆栈（错误码口径见 `docs/contracts/README.md`）。
 */
export const ARTICLE_ERRORS = {
  // 与 lib/auth/permissions.ts 的 PERMISSION_DENIED_MESSAGES['article.write'] 同串：
  // 同一个权限只有一句拒绝话（见 `docs/contracts/README.md`、constitution 原则 V）。
  forbidden: '你没有撰写谱文的权限',
  not_found: '谱文不存在或已删除',
  page_not_found: '这一页已被删除，你的文字仍保留在本地，请刷新后重新添加一页',
  last_page: '至少要保留一页',
  max_pages: '一篇谱文最多 100 页',
  too_many_images: '每页最多 6 张图片',
  invalid_image: '只支持 JPG / PNG / WebP，单张不超过 10MB',
  invalid_doc: '内容格式不正确，请刷新页面后重试',
  catalog_referenced: '这篇谱文被谱书编目引用，请先在谱书里移除编目',
} as const;

export type ArticleErrorCode = keyof typeof ARTICLE_ERRORS;
