import { describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';

// The search boundary decided in ADR 0011, asserted against a real database so
// it cannot drift back silently:
//   - person search runs in memory (matchLineagePerson over getNodes), so node
//     carries no trigram index;
//   - FR-ART-5 needs idx_article_search, so article keeps exactly one;
//   - idx_article_search depends on pg_trgm, so the extension must survive.

describe('search boundary', () => {
  it('keeps no trigram index on node', async () => {
    const nodeTrgm = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'node'
        and indexdef ilike ${'%gin_trgm_ops%'}`;

    expect(nodeTrgm).toEqual([]);
  });

  it('keeps the article trigram index and nothing else on article', async () => {
    const articleTrgm = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'article'
        and indexdef ilike ${'%gin_trgm_ops%'}`;

    expect(articleTrgm.map((row) => row.indexname)).toEqual([
      'idx_article_search',
    ]);
  });

  it('keeps the pg_trgm extension that idx_article_search depends on', async () => {
    const extensions = await getTestSql()<
      { extname: string }[]
    >`select extname from pg_extension where extname = 'pg_trgm'`;

    expect(extensions).toEqual([{ extname: 'pg_trgm' }]);
  });
});
