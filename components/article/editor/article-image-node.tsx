import Image from '@tiptap/extension-image';

import {
  ARTICLE_IMAGE_WIDTHS,
  DEFAULT_ARTICLE_IMAGE_WIDTH,
} from '@/lib/article/constants';
import { mediaUrl } from '@/lib/article/media/path';

/**
 * 正文插图节点（FR-025、FR-026、ADR 0019）。
 *
 * 文档里**只存 pathname**（`articles/<组织>/<谱文>/<文件>`），不存直链：
 * 图片地址每次渲染现拼，走服务端代理，授权在那一步做——把 URL 存进文档会让
 * 换存储或过期时全文失效。三档宽度是规格给的全部尺寸控制，裁剪与自由缩放
 * 不在本期（FR-044）。
 */

export type ArticleImageWidth = (typeof ARTICLE_IMAGE_WIDTHS)[number];

const WIDTH_CLASS: Record<ArticleImageWidth, string> = {
  small: 'w-1/3',
  medium: 'w-2/3',
  full: 'w-full',
};

function isWidth(value: unknown): value is ArticleImageWidth {
  return (
    typeof value === 'string' &&
    (ARTICLE_IMAGE_WIDTHS as readonly string[]).includes(value)
  );
}

export const articleImage = Image.extend({
  name: 'articleImage',
  addAttributes() {
    return {
      pathname: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-pathname'),
        renderHTML: (attributes) => ({ 'data-pathname': attributes.pathname }),
      },
      width: {
        default: DEFAULT_ARTICLE_IMAGE_WIDTH,
        parseHTML: (element) => element.getAttribute('data-width'),
        renderHTML: (attributes) => ({ 'data-width': attributes.width }),
      },
    };
  },
  renderHTML({ node }) {
    const pathname = String(node.attrs.pathname ?? '');
    const width = isWidth(node.attrs.width)
      ? node.attrs.width
      : DEFAULT_ARTICLE_IMAGE_WIDTH;
    return [
      'img',
      {
        src: mediaUrl(pathname),
        'data-pathname': pathname,
        'data-width': width,
        // 本期不做图注与替代文本输入（FR-031），留空比让用户填一个假的强。
        alt: '',
        class: WIDTH_CLASS[width],
      },
    ];
  },
});

/** 在光标处插入一张已上传好的插图（块级、独占一行）。 */
export function articleImageNode(pathname: string): {
  type: string;
  attrs: { pathname: string; width: ArticleImageWidth };
} {
  return {
    type: 'articleImage',
    attrs: { pathname, width: DEFAULT_ARTICLE_IMAGE_WIDTH },
  };
}
