import { describe, expect, it } from 'vitest';
import { getTestSql } from '../helpers/db';

// The search boundary decided in ADR 0011, asserted against a real database so
// it cannot drift back silently:
//   - person search runs in memory (matchLineagePerson over getNodes), so node
//     carries no trigram index;
//   - article title search also runs in memory over the fully loaded list, so
//     article carries no trigram index until FR-ART-5 body search ships a query;
//   - pg_trgm stays installed so that day is one CREATE INDEX, not CREATE EXTENSION.

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

  it('keeps the pg_trgm extension for the day FR-ART-5 body search ships', async () => {
    const extensions = await getTestSql()<
      { extname: string }[]
    >`select extname from pg_extension where extname = 'pg_trgm'`;

    expect(extensions).toEqual([{ extname: 'pg_trgm' }]);
  });
});
