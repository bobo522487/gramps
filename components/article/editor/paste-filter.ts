/**
 * 粘贴清洗（FR-013、FR-031）。
 *
 * 从 Word、网页、别的编辑器里粘进来的 HTML 带着谱文不收的东西：三级以上标题、
 * 加粗斜体、代码、表格、列表、引用、链接、外链图片、内联样式。规则是
 * **结构降级、文字保留**——一个字都不许在粘贴时悄悄丢了，也不许留下
 * 指向站外地址的图片（FR-034：图片只从我们自己的媒体通道进来）。
 *
 * 这里是纯字符串变换，跑在浏览器（`transformPastedHTML`）也跑在 node 测试里，
 * 不依赖 DOMParser；ProseMirror 的 schema 会在其后按白名单再过滤一层。
 */

/** 只留内容、丢标记的行内标签。 */
const INLINE_MARK_TAGS = [
  'b',
  'strong',
  'i',
  'em',
  'u',
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

/** 块级标签 → 段落。 */
const BLOCK_TO_PARAGRAPH = [
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
  'td',
  'th',
  'tr',
  'dd',
  'dt',
];

/** 段落化时应当忽略的容器（只留里面的 li/p 等）。 */
const TRANSPARENT_CONTAINERS = [
  'body',
  'html',
  'table',
  'tbody',
  'thead',
  'tfoot',
  'colgroup',
  'ul',
  'ol',
  'dl',
  'center',
];

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

export function sanitizePasteHtml(html: string): string {
  if (!html.trim()) {
    return '';
  }

  let out = html;

  // 注释与整块丢弃的元素先清掉，避免后面的规则误伤。
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  out = dropEntirely(out, DROP_WITH_CONTENT);

  // 图片一律丢弃：谱文的图只走自己的媒体通道。
  out = out.replace(/<img\b[^>]*>/gi, '');

  // 链接、代码只留文字。
  out = stripTags(out, ['a', 'code']);
  // 加粗、斜体、下划线、上下标、字体颜色等内联标记全部剥掉（FR-031）。
  out = stripTags(out, INLINE_MARK_TAGS);

  // 三级以上标题降级成段落；一、二级留作标题。
  out = out.replace(/<h([3-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, '<p>$2</p>');
  out = out.replace(/<h([12])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, '<h$1>$2</h$1>');

  // 列表项各自成段，然后丢掉列表外壳；换行同理。
  out = out.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, '<p>$1</p>');
  out = stripTags(out, [...BLOCK_TO_PARAGRAPH, ...TRANSPARENT_CONTAINERS]);
  out = out.replace(/<br\s*\/?>/gi, '');

  // 剩下的段落与标题：去属性、去空块。
  out = out.replace(/<p\b[^>]*>/gi, '<p>');
  out = out.replace(/<h([12])\b[^>]*>/gi, '<h$1>');
  out = out.replace(/<p>\s*<\/p>/gi, '');

  // 兜底：没被任何块包住的裸文字（含纯文本粘贴）提成段落。
  out = normalizeLooseText(out);

  return out.trim();
}

/**
 * 把不在 `<p>/<h1>/<h2>` 里的文字包成段落。
 *
 * 只按标签边界切段：段内若已含块级标签就原样保留，否则整段套一个 `<p>`。
 * 段落内部的 `&nbsp;` 等空白不算内容，直接省掉。
 */
function normalizeLooseText(html: string): string {
  const parts = html.split(
    /(<(?:p|h1|h2)\b[^>]*>[\s\S]*?<\/(?:p|h1|h2)\s*>)/gi
  );
  const out: string[] = [];

  for (const part of parts) {
    if (!part) {
      continue;
    }
    if (/^<(?:p|h1|h2)\b/i.test(part)) {
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
