import { describe, expect, it } from 'vitest';

import {
  ARTICLE_FONT_FAMILIES,
  ARTICLE_FONT_SIZES,
} from '@/lib/article/constants';
import {
  articleContentSchema,
  articlePageDocSchema,
} from '@/lib/article/schemas';

const ORG_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const ARTICLE_ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';
const PREFIX = `articles/${ORG_ID}/${ARTICLE_ID}/`;

function image(pathname = `${PREFIX}a.jpg`, width?: string) {
  return {
    type: 'articleImage',
    attrs: width === undefined ? { pathname } : { pathname, width },
  };
}

function paragraph(text = '正文') {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function doc(nodes: unknown[]) {
  return { type: 'doc', content: nodes };
}

function page(id: string, nodes: unknown[]) {
  return { id, doc: doc(nodes) };
}

function articleContent(pages: unknown[]) {
  return { schemaVersion: 1, pages };
}

function parseContent(pages: unknown[]) {
  return articleContentSchema({
    orgId: ORG_ID,
    articleId: ARTICLE_ID,
  }).safeParse(articleContent(pages));
}

describe('articlePageDocSchema（节点与 mark 白名单）', () => {
  it('接受段落、两级标题与图片', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: '谱序' }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: '小目' }],
        },
        paragraph(),
        image(),
      ])
    );

    expect(result.success).toBe(true);
  });

  it('拒绝白名单外的节点（表格）', () => {
    const result = articlePageDocSchema.safeParse(
      doc([paragraph(), { type: 'table', content: [] }])
    );

    expect(result.success).toBe(false);
  });

  it('拒绝白名单外的 mark（加粗）', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '重点', marks: [{ type: 'bold' }] }],
        },
      ])
    );

    expect(result.success).toBe(false);
  });

  it('接受 textStyle 里的白名单字体与字号', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '楷体',
              marks: [
                {
                  type: 'textStyle',
                  attrs: { fontFamily: 'KaiTi', fontSize: '19px' },
                },
              ],
            },
          ],
        },
      ])
    );

    expect(result.success).toBe(true);
  });

  // 规格只放行系统自带的三种字体与三个档位（FR-030）；清单本身在
  // `lib/article/constants.ts`，这里逐条钉住「清单内的都能存、清单外的都存不进」。
  for (const family of ARTICLE_FONT_FAMILIES) {
    it(`接受白名单内的字体 ${family}`, () => {
      const result = articlePageDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '宋体正文',
                marks: [{ type: 'textStyle', attrs: { fontFamily: family } }],
              },
            ],
          },
        ])
      );

      expect(result.success).toBe(true);
    });
  }

  for (const size of ARTICLE_FONT_SIZES) {
    it(`接受白名单内的字号 ${size}`, () => {
      const result = articlePageDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '字号档位',
                marks: [{ type: 'textStyle', attrs: { fontSize: size } }],
              },
            ],
          },
        ])
      );

      expect(result.success).toBe(true);
    });
  }

  for (const family of ['微软雅黑', 'Microsoft YaHei', 'Comic Sans MS']) {
    it(`拒绝白名单外的字体 ${family}`, () => {
      const result = articlePageDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '外部字体',
                marks: [{ type: 'textStyle', attrs: { fontFamily: family } }],
              },
            ],
          },
        ])
      );

      expect(result.success).toBe(false);
    });
  }

  for (const size of ['28px', '12pt', '1.5em']) {
    it(`拒绝白名单外的字号 ${size}`, () => {
      const result = articlePageDocSchema.safeParse(
        doc([
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: '自定义大小',
                marks: [{ type: 'textStyle', attrs: { fontSize: size } }],
              },
            ],
          },
        ])
      );

      expect(result.success).toBe(false);
    });
  }

  it('拒绝白名单外的字体', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '花体',
              marks: [
                { type: 'textStyle', attrs: { fontFamily: 'Comic Sans' } },
              ],
            },
          ],
        },
      ])
    );

    expect(result.success).toBe(false);
  });

  it('拒绝白名单外的字号档位', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: '超大',
              marks: [{ type: 'textStyle', attrs: { fontSize: '40px' } }],
            },
          ],
        },
      ])
    );

    expect(result.success).toBe(false);
  });

  it('图片宽度缺省归一化为 full', () => {
    const result = articlePageDocSchema.safeParse(doc([image()]));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const nodes = (result.data.content ?? []) as {
      type: string;
      attrs?: { width?: string };
    }[];
    expect(nodes[0].attrs?.width).toBe('full');
  });

  it('拒绝非法宽度档位', () => {
    const result = articlePageDocSchema.safeParse(
      doc([image(undefined, 'huge')])
    );

    expect(result.success).toBe(false);
  });

  it('拒绝三级标题', () => {
    const result = articlePageDocSchema.safeParse(
      doc([
        {
          type: 'heading',
          attrs: { level: 3 },
          content: [{ type: 'text', text: 'x' }],
        },
      ])
    );

    expect(result.success).toBe(false);
  });
});

describe('articleContentSchema（分页文档包）', () => {
  it('接受一页合法文档', () => {
    expect(parseContent([page('p1', [paragraph()])]).success).toBe(true);
  });

  it('拒绝 schemaVersion 不为 1', () => {
    const result = articleContentSchema({
      orgId: ORG_ID,
      articleId: ARTICLE_ID,
    }).safeParse({
      schemaVersion: 2,
      pages: [page('p1', [paragraph()])],
    });

    expect(result.success).toBe(false);
  });

  it('拒绝 0 页', () => {
    expect(parseContent([]).success).toBe(false);
  });

  it('拒绝 101 页', () => {
    const pages = Array.from({ length: 101 }, (_, i) =>
      page(`p${i}`, [paragraph(`第 ${i} 页`)])
    );

    expect(parseContent(pages).success).toBe(false);
  });

  it('接受 100 页（边界内）', () => {
    const pages = Array.from({ length: 100 }, (_, i) =>
      page(`p${i}`, [paragraph(`第 ${i} 页`)])
    );

    expect(parseContent(pages).success).toBe(true);
  });

  it('拒绝重复的页标识', () => {
    const result = parseContent([
      page('same', [paragraph('甲')]),
      page('same', [paragraph('乙')]),
    ]);

    expect(result.success).toBe(false);
  });

  it('拒绝单页第 7 张图片', () => {
    const nodes = Array.from({ length: 7 }, (_, i) =>
      image(`${PREFIX}i${i}.jpg`)
    );

    expect(parseContent([page('p1', nodes)]).success).toBe(false);
  });

  it('接受单页 6 张图片（边界内）', () => {
    const nodes = Array.from({ length: 6 }, (_, i) =>
      image(`${PREFIX}i${i}.jpg`)
    );

    expect(parseContent([page('p1', nodes)]).success).toBe(true);
  });

  it('同一页码内每页各自 6 张不叠加', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      image(`${PREFIX}x${i}.jpg`)
    );

    expect(
      parseContent([
        page('p1', six),
        page(
          'p2',
          six.map((n, i) => ({
            ...n,
            attrs: { ...n.attrs, pathname: `${PREFIX}y${i}.jpg` },
          }))
        ),
      ]).success
    ).toBe(true);
  });

  it('拒绝引用别的谱文的图片路径', () => {
    const result = parseContent([
      page('p1', [
        image(`articles/${ORG_ID}/99999999-9999-4999-8999-999999999999/a.jpg`),
      ]),
    ]);

    expect(result.success).toBe(false);
  });

  it('拒绝引用别的组织的图片路径', () => {
    const result = parseContent([
      page('p1', [
        image('articles/00000000-0000-4000-8000-000000000000/x/a.jpg'),
      ]),
    ]);

    expect(result.success).toBe(false);
  });

  it('拒绝不以 articles/ 开头的路径', () => {
    expect(parseContent([page('p1', [image('evil/a.jpg')])]).success).toBe(
      false
    );
  });
});
