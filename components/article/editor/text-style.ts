import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';

/**
 * 字体与字号（FR-030、US4，P2）。
 *
 * 裸的 `TextStyle` 只是一个「能挂 inline style 的壳」，不认识任何属性：
 * `setMark('textStyle', { fontFamily })` 传进去的 attrs 会被 ProseMirror 丢掉，
 * 既不落库也不渲染。`FontFamily` / `FontSize` 把这两个属性挂到 `textStyle` 上，
 * 并输出 inline style —— 复制带格式（US4-AC2）靠的就是这份 style 输出。
 *
 * 「无楷体环境显示替代字体」（US4-AC3）不需要我们做额外的事：只写字体名、
 * 不嵌字体文件，浏览器没有该字体时按 CSS 规则自行替代，不会出方块。
 *
 * 白名单在服务端 `lib/article/schemas.ts` 校验（`ARTICLE_FONT_FAMILIES` /
 * `ARTICLE_FONT_SIZES`），这里不维护第二份清单（宪法 V）。
 */
// 三个扩展单独导出、在编辑器里逐个列出：把它们塞进同一个数组会让 TS 把
// `Mark<TextStyleOptions>` 与 `Extension<FontFamilyOptions>` 并成联合类型，
// 传给 `extensions` 时报「Index signature for type 'string' is missing」。
export const articleTextStyle = TextStyle;
export const articleFontFamily = FontFamily;
export const articleFontSize = FontSize;
