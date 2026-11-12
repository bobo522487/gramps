import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const ddl = read('lib/db/migrations/0000_target_schema.sql');
const tsSchemas = [
  'lib/db/schema/project.ts',
  'lib/db/schema/person.ts',
  'lib/db/schema/family.ts',
  'lib/db/schema/event.ts',
  'lib/db/schema/lineage.ts',
  'lib/db/schema/content.ts',
  'lib/db/schema/book-export.ts',
]
  .map(read)
  .join('\n');
const snapshot = JSON.parse(
  read('lib/db/migrations/meta/0000_snapshot.json')
) as {
  tables: Record<string, { uniqueConstraints?: Record<string, unknown> }>;
};

const CONTENT_TABLES = [
  'folder',
  'person',
  'person_name',
  'family',
  'family_partner',
  'family_child',
  'event',
  'lineage',
  'node',
  'article',
  'book',
  'book_catalog',
  'book_export',
] as const;

const expectedUnique = (table: string) => ({
  name: `${table}_id_global`,
  nullsNotDistinct: false,
  columns: ['id'],
});

/** Split the baseline DDL into `CREATE TABLE <name> ( ... );` blocks. */
function ddlBlocks(sql: string): Array<{ table: string; body: string }> {
  const starts = [...sql.matchAll(/CREATE TABLE\s+([\w.]+)\s*\(/g)];
  return starts.map((match, index) => ({
    table: match[1],
    body: sql.slice(
      match.index,
      index + 1 < starts.length ? starts[index + 1].index : sql.length
    ),
  }));
}

describe('13 张 (project_id, id) 内容表的 id 全局唯一', () => {
  test('三份镜像都带 <table>_id_global UNIQUE (id)', () => {
    for (const table of CONTENT_TABLES) {
      expect(ddl).toContain(`CONSTRAINT ${table}_id_global UNIQUE (id)`);
      expect(tsSchemas).toContain(`unique('${table}_id_global').on(t.id)`);
      expect(
        snapshot.tables[`public.${table}`]?.uniqueConstraints?.[
          `${table}_id_global`
        ]
      ).toEqual(expectedUnique(table));
    }
  });

  test('DDL 的复合主键内容表恰好是这 13 张', () => {
    const pkTables = ddlBlocks(ddl)
      .filter((block) => block.body.includes('PRIMARY KEY (project_id, id)'))
      .map((block) => block.table.replace(/^public\./, ''));
    expect(pkTables).toHaveLength(13);
    expect([...pkTables].sort()).toEqual([...CONTENT_TABLES].sort());
  });

  test('单列 eq(*.id, …) join 的目标表都在全局唯一清单里', () => {
    const queries =
      read('lib/db/queries/articles.ts') + read('lib/db/queries/lineages.ts');
    const aliasToTable: Record<string, string> = {
      folders: 'folder',
      books: 'book',
      bookCatalogs: 'book_catalog',
      lineages: 'lineage',
    };
    const joined = [
      ...queries.matchAll(/\.innerJoin\((\w+),\s*eq\(\1\.id,/g),
    ].map((match) => match[1]);
    expect(joined.length).toBeGreaterThan(0);
    for (const alias of joined) {
      expect(CONTENT_TABLES).toContain(aliasToTable[alias]);
    }
  });

  test('今后新增的复合主键表必须同时带全局唯一约束', () => {
    for (const block of ddlBlocks(ddl)) {
      if (!block.body.includes('PRIMARY KEY (project_id, id)')) continue;
      const table = block.table.replace(/^public\./, '');
      expect(CONTENT_TABLES).toContain(table);
      expect(block.body).toContain(`CONSTRAINT ${table}_id_global UNIQUE (id)`);
    }
  });
});
