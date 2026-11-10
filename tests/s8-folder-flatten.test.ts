import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const root = process.cwd();

function read(path: string): string {
  return readFileSync(join(root, path), 'utf8');
}

/** 截出 `export const xxx = pgTable( ... );` 这一段，避免整文件误伤。 */
function tableBlock(source: string, name: string): string {
  const marker = `export const ${name} = pgTable(`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return '';
  }
  const rest = source.slice(start);
  const end = rest.indexOf('\n);');
  return end < 0 ? rest : rest.slice(0, end);
}

/**
 * #14 独立批次门禁：`folder` 按附录 A.2 压平成单层。
 *
 * 目标态 6 列（`organization_id` / `project_id` / `id` / `name` / `seq` /
 * `created_at`），没有 `kind` / `parent_id` / `sort` / `created_by`；三类内容
 * （谱系 / 谱文 / 谱书）共用同一套项目内分类，`folder_name_unique (project_id,
 * name)` 全项目唯一。静态断言只读文本，不 import 待测模块。
 */
describe('S8 #14：folder 压平为单层（附录 A.2）', () => {
  test('F-1 基线 DDL：folder 只有 6 列，父指针 / kind / sort / created_by 全部收回', () => {
    const ddl = read('lib/db/migrations/0000_target_schema.sql');
    const body = ddl.split('CREATE TABLE folder (')[1]?.split('\n);')[0] ?? '';
    expect(body, 'folder 表定义缺失').not.toBe('');

    for (const column of ['kind', 'parent_id', 'sort', 'created_by']) {
      expect(body, `folder 仍有 ${column} 列`).not.toMatch(
        new RegExp(`^\\s*${column}\\s`, 'm')
      );
    }
    for (const column of [
      'organization_id',
      'project_id',
      'id',
      'name',
      'seq',
      'created_at',
    ]) {
      expect(body, `folder 缺 ${column} 列`).toMatch(
        new RegExp(`^\\s*${column}\\s`, 'm')
      );
    }

    expect(body).toContain('PRIMARY KEY (project_id, id)');
    expect(body).toContain('folder_name_unique UNIQUE (project_id, name)');
    // 父指针 / 分类判别 / 旧排序索引一并退役。
    expect(ddl).not.toContain('fk_folder_parent_same_project');
    expect(ddl).not.toContain('uk_folder_org_project_id');
    expect(ddl).not.toContain('idx_folder_project');
    expect(ddl).toContain('folder_order_idx ON folder (project_id, seq)');
  });

  test('F-2 TS schema 与基线同形：folders 只留 6 列与两条约束', () => {
    const block = tableBlock(read('lib/db/schema/project.ts'), 'folders');
    expect(block, 'folders 定义缺失').not.toBe('');
    for (const column of ['kind:', 'parentId:', 'sort:', 'createdBy:']) {
      expect(block, `folders 仍有 ${column}`).not.toContain(column);
    }
    for (const column of [
      'orgId:',
      'projectId:',
      'name:',
      'seq:',
      'createdAt:',
    ]) {
      expect(block, `folders 缺 ${column}`).toContain(column);
    }
    expect(block).toContain('folder_name_unique');
    expect(block).toContain('folder_order_idx');
    expect(block).not.toContain('fk_folder_parent_same_project');
    expect(block).not.toContain('idx_folder_project');
  });

  test('F-3 服务层：去掉 kind / parentId / 深度上限，seq 取代 sort', () => {
    const services = read('lib/folder/services.ts');
    expect(services).not.toContain('folders.kind');
    expect(services).not.toContain('parentId');
    expect(services).not.toContain('folderDepth');
    expect(services).not.toContain('invalid_parent');
    expect(services).not.toContain('depth_exceeded');
    expect(services).not.toContain('nextFolderSort');
    expect(services).toContain('nextFolderSeq');
    // 三类内容共用一套分类：删一个分类要把三张表的 folder_id 都置空。
    expect(services).toContain('articles');
    expect(services).toContain('lineages');
    expect(services).toContain('books');
  });

  test('F-4 查询层：getFolders 不再按 kind 过滤，按 seq 排序', () => {
    const queries = read('lib/db/queries/folders.ts');
    expect(queries).toMatch(
      /export async function getFolders\([\s\S]*?userId: string,[\s\S]*?orgId: string,[\s\S]*?projectId: string[\s\S]*?\)/
    );
    // 注释里可以解释「不再按 kind 过滤」，所以只看代码层引用。
    expect(queries).not.toMatch(/\bkind\s*:/);
    expect(queries).not.toContain('folders.kind');
    expect(queries).toContain('asc(folders.seq)');
  });

  test('F-5 谱文查询：分类树与 kind 过滤退役，删分类预览不再组树', () => {
    const articles = read('lib/db/queries/articles.ts');
    expect(articles).not.toContain('folders.kind');
    expect(articles).not.toContain('childrenOf');
    expect(articles).not.toContain('parentId');
    // 预览口径改为「这一条分类下的谱文数」，不再连带子树。
    expect(articles).toContain('getFolderDeletePreview');
  });

  test('F-6 谱文写入：分类校验与默认分类都不再区分 kind / parent', () => {
    const mutations = read('lib/article/mutations.ts');
    expect(mutations).not.toContain('folders.kind');
    expect(mutations).not.toContain('isNull(folders.parentId)');
    expect(mutations).not.toContain('nextFolderSort');
    // 压平后「默认分类」全项目只应有一条，并发创建必须靠唯一键兜住；
    // 这段逻辑已经下沉到 folder 域，与谱系侧共用。
    const folderServices = read('lib/folder/services.ts');
    expect(folderServices).toMatch(/onConflictDoNothing|on conflict do nothing/i);
  });

  test('F-7 入参与 Action：createFolder 不再收 kind / parentId', () => {
    const schemas = read('lib/genealogy/schemas.ts');
    const block =
      schemas
        .split('export const createFolderSchema = z.object(')[1]
        ?.split('});')[0] ?? '';
    expect(block, 'createFolderSchema 缺失').not.toBe('');
    expect(block).not.toContain('kind');
    expect(block).not.toContain('parentId');

    const actions = read('lib/folder/actions.ts');
    expect(actions).not.toContain('kind');
    expect(actions).not.toContain('parentId');
    expect(actions).not.toContain('invalid_parent');
    expect(actions).not.toContain('depth_exceeded');
  });

  test('F-8 前端：分类树换成平铺列表，节点不再带 parentId', () => {
    const article = read('components/article/types.ts');
    const node =
      article.split('export type ArticleFolderNode = {')[1]?.split('};')[0] ??
      '';
    expect(node, 'ArticleFolderNode 缺失').not.toBe('');
    expect(node).not.toContain('parentId');
    expect(article).not.toContain('childrenOf');

    const lineage = read('components/lineage/types.ts');
    const option =
      lineage.split('export type FolderOption = {')[1]?.split('};')[0] ?? '';
    expect(option, 'FolderOption 缺失').not.toBe('');
    expect(option).not.toContain('parentId');

    // 组树逻辑在 lineage-tree.ts：父子索引与 depth / children 都该退役。
    const tree = read('components/lineage/lineage-tree.ts');
    expect(tree).not.toContain('childrenByParent');
    const folderNode =
      tree.split('export type LineageTreeFolder = {')[1]?.split('};')[0] ?? '';
    expect(folderNode, 'LineageTreeFolder 缺失').not.toBe('');
    expect(folderNode).not.toContain('children');
    expect(folderNode).not.toContain('depth:');
  });

  test('F-9 导航层：getFolders 调用不再传 kind', () => {
    expect(read('lib/article/nav.ts')).not.toMatch(
      /getFolders\([^)]*,\s*1\s*\)/
    );
    expect(read('lib/lineage/nav.ts')).not.toMatch(
      /getFolders\([^)]*,\s*0\s*\)/
    );
  });
});
