import { describe, expect, it } from 'vitest';
import {
  type ArticleContent,
  type ArticleNode,
  type ArticlePage,
  type ArticlePageDoc,
  countImages,
  createEmptyPageDoc,
  derivePlainText,
  isReferenced,
  normalizePageDoc,
  pagePlainText,
  parseArticleContent,
} from '@/lib/article/doc';
import { mediaUrl } from '@/lib/article/media/path';

const ORG_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ARTICLE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

function textNode(value: string): ArticleNode {
  return { type: 'text', text: value };
}

function paragraph(value: string): ArticleNode {
  return { type: 'paragraph', content: [textNode(value)] };
}

function imageNode(pathname: string, width = 'full'): ArticleNode {
  return { type: 'articleImage', attrs: { pathname, width } };
}

function pageDoc(nodes: ArticleNode[]): ArticlePageDoc {
  return { type: 'doc', content: nodes };
}

function content(pages: ArticlePage[]): ArticleContent {
  return { schemaVersion: 1, pages };
}

describe('pagePlainText（页缩略图的文本摘要）', () => {
  it('只取这一页的块级文本，标题也算进去', () => {
    const doc = {
      type: 'doc' as const,
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: '谱序' }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: '吾族世系' }] },
        { type: 'articleImage', attrs: { pathname: 'articles/a/b/c.png' } },
      ],
    };
    expect(pagePlainText(doc)).toBe('谱序\n\n吾族世系');
  });

  it('空页返回空串（新加的页就是这个样子）', () => {
    expect(pagePlainText(createEmptyPageDoc())).toBe('');
  });
});

describe('derivePlainText', () => {
  it('按页序收集文本，页间用空行连接', () => {
    const result = derivePlainText(
      content([
        {
          id: 'p1',
          doc: pageDoc([paragraph('始祖谱序'), paragraph('第一页正文')]),
        },
        { id: 'p2', doc: pageDoc([paragraph('第二页正文')]) },
      ])
    );

    expect(result).toBe('始祖谱序\n\n第一页正文\n\n第二页正文');
  });

  it('图片节点不贡献文本', () => {
    const result = derivePlainText(
      content([
        {
          id: 'p1',
          doc: pageDoc([
            paragraph('图前'),
            imageNode(`articles/${ORG_ID}/${ARTICLE_ID}/a.jpg`),
            paragraph('图后'),
          ]),
        },
      ])
    );

    expect(result).toBe('图前\n\n图后');
    expect(result).not.toContain('articles/');
  });

  it('标题里的文本同样进 plain_text', () => {
    const result = derivePlainText(
      content([
        {
          id: 'p1',
          doc: pageDoc([
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [textNode('凡例')],
            },
            paragraph('正文'),
          ]),
        },
      ])
    );

    expect(result).toBe('凡例\n\n正文');
  });

  it('空文档得到空字符串', () => {
    expect(derivePlainText(content([{ id: 'p1', doc: pageDoc([]) }]))).toBe('');
  });
});

describe('countImages', () => {
  it('跨页统计 articleImage 节点', () => {
    const result = countImages(
      content([
        {
          id: 'p1',
          doc: pageDoc([
            imageNode(`articles/${ORG_ID}/${ARTICLE_ID}/a.jpg`),
            paragraph('中间'),
            imageNode(`articles/${ORG_ID}/${ARTICLE_ID}/b.png`),
          ]),
        },
        {
          id: 'p2',
          doc: pageDoc([imageNode(`articles/${ORG_ID}/${ARTICLE_ID}/c.webp`)]),
        },
      ])
    );

    expect(result).toBe(3);
  });

  it('没有图片时为 0', () => {
    expect(
      countImages(content([{ id: 'p1', doc: pageDoc([paragraph('纯文字')]) }]))
    ).toBe(0);
  });
});

describe('isReferenced', () => {
  const pathname = `articles/${ORG_ID}/${ARTICLE_ID}/a.jpg`;

  it('命中被引用的 pathname', () => {
    expect(
      isReferenced(
        pathname,
        content([{ id: 'p1', doc: pageDoc([imageNode(pathname)]) }])
      )
    ).toBe(true);
  });

  it('同一 pathname 出现在另一页也算命中', () => {
    expect(
      isReferenced(
        pathname,
        content([
          { id: 'p1', doc: pageDoc([paragraph('无图')]) },
          { id: 'p2', doc: pageDoc([imageNode(pathname)]) },
        ])
      )
    ).toBe(true);
  });

  it('不命中其它 pathname', () => {
    expect(
      isReferenced(
        pathname,
        content([
          {
            id: 'p1',
            doc: pageDoc([
              imageNode(`articles/${ORG_ID}/${ARTICLE_ID}/other.jpg`),
            ]),
          },
        ])
      )
    ).toBe(false);
  });
});

describe('parseArticleContent', () => {
  it('合法的分页文档原样返回', () => {
    const value = content([{ id: 'p1', doc: pageDoc([paragraph('谱序')]) }]);

    expect(parseArticleContent(value)).toEqual(value);
  });

  for (const [label, value] of [
    ['null', null],
    ['undefined', undefined],
    ['旧单文档形状', pageDoc([paragraph('序')])],
    ['空 pages 数组', { schemaVersion: 1, pages: [] }],
    [
      'schemaVersion 不匹配',
      { schemaVersion: 2, pages: [{ id: 'p1', doc: null }] },
    ],
    ['页不是对象', { schemaVersion: 1, pages: ['x'] }],
    ['不是对象的标量', 42],
  ] as const) {
    it(`旧值「${label}」兜底成一页空文档且不抛错`, () => {
      const result = parseArticleContent(value);

      expect(result.schemaVersion).toBe(1);
      expect(result.pages).toHaveLength(1);
      expect(result.pages[0].id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.pages[0].doc).toEqual({ type: 'doc', content: [] });
      expect(derivePlainText(result)).toBe('');
    });
  }

  it('兜底页的 id 每次不同（不能撞车）', () => {
    const a = parseArticleContent(null);
    const b = parseArticleContent(null);

    expect(a.pages[0].id).not.toBe(b.pages[0].id);
  });

  it('丢弃白名单外的节点但保留合法部分', () => {
    const result = parseArticleContent(
      content([
        {
          id: 'p1',
          doc: pageDoc([paragraph('留下'), { type: 'table', content: [] }]),
        },
      ])
    );

    expect(result.pages[0].doc.content).toHaveLength(1);
    expect(derivePlainText(result)).toBe('留下');
  });
});

describe('mediaUrl（图片走服务端代理）', () => {
  it('拼成 /api/media/<pathname>', () => {
    expect(mediaUrl('articles/org/artifact/one.png')).toBe(
      '/api/media/articles/org/artifact/one.png'
    );
  });

  it('逐段编码，路径穿越到不了代理', () => {
    expect(mediaUrl('articles/org/..%2F..%2Fetc/one.png')).toBe(
      '/api/media/articles/org/..%252F..%252Fetc/one.png'
    );
  });
});

describe('空文档的形状（TipTap 的 getJSON 不保证带 content 数组）', () => {
  it('parseArticleContent 接受缺 content 的页并补成空数组', () => {
    const parsed = parseArticleContent({
      schemaVersion: 1,
      pages: [{ id: 'p1', doc: { type: 'doc' } }],
    });
    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0]?.id).toBe('p1');
    expect(parsed.pages[0]?.doc).toEqual({ type: 'doc', content: [] });
  });

  it('normalizePageDoc 把缺 content 的文档补成空数组并丢掉白名单外节点', () => {
    expect(normalizePageDoc({ type: 'doc' })).toEqual({
      type: 'doc',
      content: [],
    });
    expect(
      normalizePageDoc({
        type: 'doc',
        content: [{ type: 'table' }, { type: 'paragraph' }],
      })
    ).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });

  it('pagePlainText 对补形后的空文档返回空串', () => {
    expect(pagePlainText(normalizePageDoc({ type: 'doc' }))).toBe('');
  });
});

describe('normalizePageDoc 的输出必须是普通对象（RSC 序列化只认普通对象）', () => {
  it('attrs 带原型，否则 Server Action 会把它整个丢掉', () => {
    // ProseMirror 的 attrsToJSON 用 Object.create(null)：JSON.stringify 看不出来，
    // 但 React 的序列化会静默丢弃无原型的对象，服务端就收到一个没有 attrs 的节点。
    const attrs = Object.create(null) as Record<string, unknown>;
    attrs.pathname = 'articles/o/a/p.png';
    attrs.width = 'medium';

    const doc = normalizePageDoc({
      type: 'doc',
      content: [{ type: 'articleImage', attrs }],
    });

    const node = doc.content[0];
    expect(node?.attrs).toBeDefined();
    expect(Object.getPrototypeOf(node?.attrs)).toBe(Object.prototype);
    expect(node?.attrs).toEqual({
      pathname: 'articles/o/a/p.png',
      width: 'medium',
    });
  });

  it('marks 里的 attrs 同样要带原型', () => {
    const markAttrs = Object.create(null) as Record<string, unknown>;
    markAttrs.fontFamily = 'KaiTi';

    const doc = normalizePageDoc({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '序',
              marks: [{ type: 'textStyle', attrs: markAttrs }],
            },
          ],
        },
      ],
    });

    const mark = doc.content[0]?.content?.[0]?.marks?.[0];
    expect(mark?.attrs).toEqual({ fontFamily: 'KaiTi' });
    expect(Object.getPrototypeOf(mark?.attrs)).toBe(Object.prototype);
  });
});
