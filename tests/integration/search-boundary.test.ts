import { describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';

// The search boundary decided in ADR 0011, asserted against a real database so
// it cannot drift back silently:
//   - person search runs in memory (matchLineagePerson over getNodes), so node
//     carries no trigram index;
//   - article title search also runs in memory over the fully loaded list, so
//     article carries no trigram index until FR-ART-5 body search ships a query;
//   - the S8 target baseline installs only ltree + btree_gist. pg_trgm is NOT
//     preinstalled: when FR-ART-5 ships, CREATE EXTENSION is an explicit deploy
//     step (ADR 0011's "keep it resident" premise was retired by the B0 squash).

describe('search boundary', () => {
  it('keeps no trigram index on node', async () => {
    const nodeTrgm = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'node'
        and indexdef ilike ${'%gin_trgm_ops%'}`;

    expect(nodeTrgm).toEqual([]);
  });

  it('keeps no trigram index on article until a query consumes one', async () => {
    const articleTrgm = await getTestSql()<
      { indexname: string }[]
    >`select indexname from pg_indexes
      where schemaname = 'public' and tablename = 'article'
        and indexdef ilike ${'%gin_trgm_ops%'}`;

    expect(articleTrgm).toEqual([]);
  });

  it('installs only the target-model extensions, not pg_trgm', async () => {
    const extensions = await getTestSql()<
      { extname: string }[]
    >`select extname from pg_extension
      where extname in ('ltree', 'btree_gist', 'pg_trgm') order by extname`;

    expect(extensions.map((row) => row.extname)).toEqual([
      'btree_gist',
      'ltree',
    ]);
  });
});
