/**
 * 粘贴清洗（FR-013 / FR-012 / 003，tasks T013）。
 *
 * 002 时几乎全剥（FR-031：加粗/斜体/下划线/列表一律降级成纯段落）；003 起
 * **有限放行**：加粗/斜体/下划线、单层 ul/ol、段落左中右对齐、两级标题。
 * 颜色、行距、表格、引用、链接、外链图片、外部主题样式仍一律丢；嵌套列表
 * 压平成单层但**保留文字**（FR-031 边界、FR-008）。与 schemas.ts / doc.ts
 * 同一份白名单常量（`ARTICLE_TEXT_ALIGNMENTS`），不另写一套。
 *
 * 这里是纯字符串变换，跑在浏览器（`transformPastedHTML`）也跑在 node 单测里，
 * 不依赖 DOMParser；ProseMirror 的 schema 会在其后按白名单再过滤一层，落库前
 * `doc.ts` 再压平一次（双端同口径）。
 */

import { ARTICLE_TEXT_ALIGNMENTS } from '@/lib/article/constants';

/** 开放的行内标记：源标签 → 规范标签（TipTap 认 strong/em/u）。 */
const KEEP_MARK_TAGS: Record<string, string> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
};

/** 只留内容、丢标记的行内标签（颜色/删除线/代码/链接/上下标/Word 杂标）。 */
const DROP_INLINE_TAGS = [
  'a',
  'code',
  'ins',
  'del',
  's',
  'strike',
  'span',
  'font',
  'small',
  'big',
  'sub',
  'sup',
  'mark',
  'q',
  'cite',
  'abbr',
  'dfn',
  'kbd',
  'samp',
  'var',
];

/** 整块丢掉的标签（连同里面内容一起不要）。 */
const DROP_WITH_CONTENT = [
  'head',
  'script',
  'style',
  'iframe',
  'video',
  'audio',
];

/** 只丢标签、内容保持原样的块级/容器（表格与 Word 外壳都降级成裸文字）。 */
const TRANSPARENT_BLOCK_TAGS = [
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'colgroup',
  'tr',
  'td',
  'th',
  'dl',
  'dd',
  'dt',
  'center',
  'body',
  'html',
];

/** 段落对齐只开放三档；与 schemas.ts 的 z.enum 同源。 */
const ALLOWED_ALIGNMENTS: ReadonlySet<string> = new Set(
  ARTICLE_TEXT_ALIGNMENTS
);

function stripTags(html: string, tags: readonly string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '');
    out = out.replace(new RegExp(`</${tag}\\s*>`, 'gi'), '');
  }
  return out;
}

function dropEntirely(html: string, tags: readonly string[]): string {
  let out = html;
  for (const tag of tags) {
    out = out.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'),
      ''
    );
  }
  return out;
}

/**
 * 从块标签的属性里只挑出对齐，生成规范 style。颜色/行距/字体等一律不认；
 * `justify` 不在 FR-009 开放范围，同样不认（防止范围漂移）。
 * Word 既写 `style="text-align:center"` 也写 `align="center"`，两者都收。
 */
function blockAlignmentStyle(attrs: string): string {
  const css = /\btext-align\s*:\s*(left|center|right|justify)\b/i.exec(attrs);
  const legacy = /\balign\s*=\s*["']?(left|center|right|justify)["']?/i.exec(
    attrs
  );
  const value = (css?.[1] ?? legacy?.[1] ?? '').toLowerCase();
  return ALLOWED_ALIGNMENTS.has(value) ? ` style="text-align: ${value}"` : '';
}

/**
 * 列表清洗：只保留一层 `ul`/`ol`，嵌套容器整个丢掉，其内部的 `li` 提升为
 * 外层列表的同级兄弟项（文字不丢）。带属性的 ul/ol/li 一律规范化成裸标签。
 *
 * 纯字符串状态机（不依赖 DOMParser）：外层容器进栈，嵌套容器只记个数用来
 * 配对吞掉闭合标签；嵌套列表结束后若还有尾随文字，再开一个 `li` 承接。
 */
function flattenLists(html: string): string {
  const tokens = html.match(/<[^>]*>|[^<]+/g);
  if (!tokens) {
    return html;
  }

  const out: string[] = [];
  /** 真正输出的外层列表容器类型。 */
  const containerStack: string[] = [];
  /** 被丢弃的嵌套容器（用来配对吞掉对应的闭合标签）。 */
  const nestedStack: string[] = [];
  let liOpen = false;

  for (const raw of tokens) {
    const isTag = raw.startsWith('<');
    const parsed = isTag
      ? /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/.exec(raw)
      : null;
    const name = parsed?.[2].toLowerCase() ?? '';
    const closing = parsed?.[1] === '/';

    if (isTag && (name === 'ul' || name === 'ol')) {
      if (closing) {
        if (nestedStack.length > 0) {
          nestedStack.pop();
        } else if (containerStack.length > 0) {
          if (liOpen) {
            out.push('</li>');
            liOpen = false;
          }
          out.push(`</${containerStack.pop()}>`);
        }
      } else if (containerStack.length === 0) {
        out.push(`<${name}>`);
        containerStack.push(name);
      } else {
        nestedStack.push(name);
      }
      continue;
    }

    if (isTag && name === 'li') {
      if (closing) {
        if (liOpen) {
          out.push('</li>');
          liOpen = false;
        }
      } else {
        if (liOpen) {
          out.push('</li>');
        }
        out.push('<li>');
        liOpen = true;
      }
      continue;
    }

    // 处在列表中但当前没有打开的 li：给尾随内容补一个 li（空白不补）。
    if (containerStack.length > 0 && !liOpen && (isTag || raw.trim() !== '')) {
      out.push('<li>');
      liOpen = true;
    }
    out.push(raw);
  }

  if (liOpen) {
    out.push('</li>');
  }
  while (containerStack.length > 0) {
    out.push(`</${containerStack.pop()}>`);
  }

  return out.join('');
}

export function sanitizePasteHtml(html: string): string {
  if (!html.trim()) {
    return '';
  }

  let out = html;

  // 注释与整块丢弃的元素先清掉，避免后面的规则误伤。
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = dropEntirely(out, DROP_WITH_CONTENT);

  // 图片一律丢弃：谱文的图只走自己的媒体通道（FR-034）。
  out = out.replace(/<img\b[^>]*>/gi, '');

  // 白名单内的行内标记规范化（去属性、统一标签）；其余行内标签只留文字。
  out = out.replace(
    /<(\/?)(b|strong|i|em|u)\b[^>]*>/gi,
    (_match, slash: string, name: string) =>
      `<${slash}${KEEP_MARK_TAGS[name.toLowerCase()]}>`
  );
  out = stripTags(out, DROP_INLINE_TAGS);

  // 列表：单层保留、嵌套压平、属性剥掉。
  out = flattenLists(out);

  // 三级以上标题降级成段落；一、二级保留。两者都只留白名单内的对齐。
  out = out.replace(
    /<h([3-6])\b([^>]*)>/gi,
    (_match, _level: string, attrs: string) =>
      `<p${blockAlignmentStyle(attrs)}>`
  );
  out = out.replace(/<\/h[3-6]\s*>/gi, '</p>');
  out = out.replace(
    /<h([12])\b([^>]*)>/gi,
    (_match, level: string, attrs: string) =>
      `<h${level}${blockAlignmentStyle(attrs)}>`
  );
  out = out.replace(
    /<p\b([^>]*)>/gi,
    (_match, attrs: string) => `<p${blockAlignmentStyle(attrs)}>`
  );

  // 其余块级/容器只留内容；换行去掉；空段落与压平产生的空 li 清掉。
  out = stripTags(out, TRANSPARENT_BLOCK_TAGS);
  out = out.replace(/<br\s*\/?>/gi, '');
  out = out.replace(/<p\b[^>]*>\s*<\/p>/gi, '');
  out = out.replace(/<li>\s*<\/li>/gi, '');

  // 兜底：没被任何块包住的裸文字（含纯文本粘贴）提成段落。
  out = normalizeLooseText(out);

  return out.trim();
}

/**
 * 把不在 `<p>/<h1>/<h2>/<ul>/<ol>` 里的文字包成段落。
 *
 * 只按标签边界切段：整块内容用反向引用配对同类闭合标签（避免 `<ul>` 里的
 * `<p>` 提前截断）。段落内部的 `&nbsp;` 等空白不算内容，直接省掉。
 */
function normalizeLooseText(html: string): string {
  // 只用**一个**捕获组：String.split 会把每个捕获组的内容也塞进结果数组，
  // 若这里用 `(<(p|h1|...)>...<\/\2>)` 配反向引用，第二个组（标签名）会被
  // 当成一段裸文字再包成 `<p>p</p>`，凭空多出垃圾段落。
  const parts = html.split(
    /(<p\b[^>]*>[\s\S]*?<\/p\s*>|<h1\b[^>]*>[\s\S]*?<\/h1\s*>|<h2\b[^>]*>[\s\S]*?<\/h2\s*>|<ul\b[^>]*>[\s\S]*?<\/ul\s*>|<ol\b[^>]*>[\s\S]*?<\/ol\s*>)/gi
  );
  const out: string[] = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (/^<(?:p|h1|h2|ul|ol)\b/i.test(part)) {
      out.push(part);
      continue;
    }
    if (
      !part
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/gi, '')
        .trim()
    ) {
      continue;
    }
    out.push(`<p>${part.trim()}</p>`);
  }

  return out.join('');
}
