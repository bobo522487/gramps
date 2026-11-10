import { describe, expect, it } from 'vitest';
import type { ArticleContent } from '@/lib/article/doc';
import { validateContent } from '@/lib/article/mutations';

const scope = {
  orgId: '00000000-0000-0000-0000-000000000001',
  articleId: '00000000-0000-0000-0000-000000000002',
};

function page(id: string, content: unknown[]) {
  return { id, doc: { type: 'doc', content } };
}

function paragraph(text: string) {
  return { type: 'paragraph', content: [{ type: 'text', text }] };
}

function image(pathname: string) {
  return { type: 'articleImage', attrs: { pathname, width: 'full' } };
}

function contentOf(pages: { id: string; doc: unknown }[]): ArticleContent {
  return { schemaVersion: 1, pages } as unknown as ArticleContent;
}

describe('validateContent', () => {
  it('accepts a document within the limits', () => {
    expect(
      validateContent(contentOf([page('p1', [paragraph('正文')])]), scope)
    ).toBeNull();
  });

  it('reports max_pages without depending on message text', () => {
    const pages = Array.from({ length: 101 }, (_, index) =>
      page(`p${index}`, [paragraph('正文')])
    );
    expect(validateContent(contentOf(pages), scope)).toBe('max_pages');
  });

  it('reports too_many_images per page', () => {
    const images = Array.from({ length: 7 }, (_, index) =>
      image(`articles/${scope.orgId}/${scope.articleId}/img-${index}.png`)
    );
    expect(validateContent(contentOf([page('p1', images)]), scope)).toBe(
      'too_many_images'
    );
  });

  it('reports invalid_doc for a malformed page', () => {
    expect(
      validateContent(contentOf([page('p1', [{ type: 'unknown' }])]), scope)
    ).toBe('invalid_doc');
  });
});
