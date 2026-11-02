import { describe, expect, it } from 'vitest';

import {
  type ArticleContent,
  type ArticleNode,
  type ArticlePage,
  type ArticlePageDoc,
  countImages,
  derivePlainText,
  isReferenced,
  parseArticleContent,
} from '@/lib/article/doc';

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
    [
      'doc 缺 content',
      { schemaVersion: 1, pages: [{ id: 'p1', doc: { type: 'doc' } }] },
    ],
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
