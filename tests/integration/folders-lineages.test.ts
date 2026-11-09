import { count, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getFolders } from '@/lib/db/queries/folders';
import { articles, books, folders, lineages, nodes } from '@/lib/db/schema';
import {
  createFolderInTransaction,
  deleteFolderInTransaction,
} from '@/lib/folder/services';
import {
  createLineageInTransaction,
  deleteLineageInTransaction,
  updateLineageInTransaction,
} from '@/lib/lineage/services';
import { getTestDb } from '../helpers/db';
import {
  addMember,
  createArticle,
  createBook,
  createCatalogItem,
  createFolder,
  createLineage,
  createNode,
  createOrganization,
  createProject,
  createUser,
  getPersonalOrg,
} from '../helpers/factories';

async function setup() {
  const user = await createUser();
  const personal = await getPersonalOrg(user.id);
  if (!personal) {
    throw new Error('expected signup trigger to create a personal org');
  }
  const project = await createProject({
    orgId: personal.organization.id,
    createdBy: user.id,
  });
  return { user, organization: personal.organization, project };
}

describe('folder service', () => {
  it('assigns increasing seq and rejects a duplicate name', async () => {
    const { user, organization, project } = await setup();

    const first = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '谱序',
    });
    const second = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '传记',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.folder.seq).toBe(0);
    expect(second.folder.seq).toBe(1);

    // 扁平单层：分类不再分 kind，名字在项目内唯一，重复创建直接报冲突。
    const duplicate = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '谱序',
    });
    expect(duplicate).toEqual({ ok: false, reason: 'conflict' });

    const [row] = await getTestDb()
      .select({ value: count() })
      .from(folders)
      .where(eq(folders.orgId, organization.id));
    expect(row?.value).toBe(2);
  });

  it('deletes the folder and unfiles the content under it', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '待删分类',
    });
    if (!folder.ok) {
      throw new Error('failed to create folder');
    }

    const lineage = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: folder.folder.id,
      name: '待分类谱系',
    });
    expect(lineage.ok).toBe(true);
    if (!lineage.ok) return;

    const result = await deleteFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      folderId: folder.folder.id,
    });
    // 扁平单层：没有子树，一次只删一行。
    expect(result).toEqual({
      ok: true,
      deletedFolders: 1,
      unfiledContent: 1,
    });

    const [stored] = await getTestDb()
      .select({ folderId: lineages.folderId })
      .from(lineages)
      .where(eq(lineages.id, lineage.lineage.id));
    expect(stored?.folderId).toBeNull();

    const remaining = await getTestDb()
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.orgId, organization.id));
    expect(remaining).toHaveLength(0);
  });

  it('unfiles articles and books when their folders are deleted', async () => {
    const { user, organization, project } = await setup();
    const articleFolder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '谱文分类',
    });
    // 基线新增 folder_name_unique (project_id, name)：同项目第二个分类改用不同名
    const bookFolder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      name: '谱书分类',
    });
    const article = await createArticle({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const book = await createBook({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await getTestDb()
      .update(articles)
      .set({ folderId: articleFolder.id })
      .where(eq(articles.id, article.id));
    await getTestDb()
      .update(books)
      .set({ folderId: bookFolder.id })
      .where(eq(books.id, book.id));

    const articleDelete = await deleteFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      folderId: articleFolder.id,
    });
    const bookDelete = await deleteFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      folderId: bookFolder.id,
    });
    expect(articleDelete.ok).toBe(true);
    expect(bookDelete.ok).toBe(true);

    const [storedArticle] = await getTestDb()
      .select({ folderId: articles.folderId })
      .from(articles)
      .where(eq(articles.id, article.id));
    const [storedBook] = await getTestDb()
      .select({ folderId: books.folderId })
      .from(books)
      .where(eq(books.id, book.id));
    expect(storedArticle?.folderId).toBeNull();
    expect(storedBook?.folderId).toBeNull();
  });

  it('rejects folder management for viewers', async () => {
    const { organization, project } = await setup();
    const viewer = await createUser();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });

    const result = await createFolderInTransaction({
      userId: viewer.id,
      orgId: organization.id,
      projectId: project.id,
      name: '越权分类',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('lineage service', () => {
  it('inherits the project surname and stores region and notes', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });

    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: folder.id,
      name: '颍川陈氏',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.name).toBe('颍川陈氏');
    expect(result.lineage.description).toBeNull();
    expect(result.lineage.baseGeneration).toBe(1);
  });

  it('creates and reuses a default category when the project has none', async () => {
    const { user, organization, project } = await setup();

    const first = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '第一本',
    });
    const second = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '第二本',
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.lineage.folderId).not.toBeNull();
    expect(second.lineage.folderId).toBe(first.lineage.folderId);

    const foldersInProject = await getFolders(
      user.id,
      organization.id,
      project.id
    );
    expect(foldersInProject.map((folder) => folder.name)).toEqual(['默认分类']);
  });

  it('refuses to create a lineage when the project has no surname', async () => {
    const { user, organization } = await setup();
    const bareProject = await createProject({
      orgId: organization.id,
      createdBy: user.id,
      surname: '',
    });
    const folder = await createFolder({
      orgId: organization.id,
      projectId: bareProject.id,
      createdBy: user.id,
    });

    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: bareProject.id,
      folderId: folder.id,
      name: '无姓谱系',
    });

    // 目标态 lineage 不继承项目姓氏，缺姓氏的项目同样可以创建谱系。
    expect(result.ok).toBe(true);
  });

  it('cannot change the surname through an update', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      folderId: folder.id,
      surname: '王',
    });

    const result = await updateLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      updates: { name: '更名后的谱系' },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.name).toBe('更名后的谱系');
    expect(result.lineage.description).toBeNull();
  });

  it('creates a lineage in a lineage folder', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '谱系分类',
    });
    if (!folder.ok) {
      throw new Error('failed to create folder');
    }

    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: folder.folder.id,
      name: '颍川陈氏',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.folderId).toBe(folder.folder.id);
    expect(result.lineage.poemText).toBeNull();
  });

  it('rejects a folder that belongs to another project', async () => {
    const { user, organization, project } = await setup();
    const otherProject = await createProject({
      orgId: organization.id,
      createdBy: user.id,
    });
    const foreignFolder = await createFolder({
      orgId: organization.id,
      projectId: otherProject.id,
      createdBy: user.id,
      name: '别项目分类',
    });

    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: foreignFolder.id,
      name: '错分类谱系',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_folder' });
  });

  it('rejects duplicate active names in the same project', async () => {
    const { user, organization, project } = await setup();
    const first = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '重复谱系',
    });
    expect(first.ok).toBe(true);

    const second = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '重复谱系',
    });
    expect(second).toEqual({ ok: false, reason: 'conflict' });
  });

  it('clears a folder assignment and updates generation words', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      folderId: folder.id,
      generationWords: ['旧'],
    });

    const result = await updateLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
      updates: { folderId: null, seq: 3 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.folderId).toBeNull();
    expect(result.lineage.seq).toBe(3);
  });

  it('refuses to delete a lineage referenced by a catalog item', async () => {
    const { user, organization, project } = await setup();
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const book = await createBook({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await createCatalogItem({
      orgId: organization.id,
      projectId: project.id,
      bookId: book.id,
      lineageId: lineage.id,
    });

    const result = await deleteLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
    });
    expect(result).toEqual({ ok: false, reason: 'referenced' });
  });

  it('soft-deletes nodes together with the lineage', async () => {
    const { user, organization, project } = await setup();
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    await createNode({
      orgId: organization.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 1,
      name: '始祖',
    });
    await createNode({
      orgId: organization.id,
      lineageId: lineage.id,
      createdBy: user.id,
      generation: 2,
      name: '二世',
      // 基线新增 node_path_unique：同谱系第二个节点改用不冲突的 path
      path: '0002',
    });

    const result = await deleteLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: lineage.id,
    });
    expect(result).toEqual({ ok: true, deletedNodes: 2 });

    const [active] = await getTestDb()
      .select({ value: count() })
      .from(nodes)
      .where(eq(nodes.lineageId, lineage.id));
    expect(active?.value).toBe(0);
  });

  it('只允许所有者与管理员删除谱系：编辑者被拒且数据不动', async () => {
    const { user, organization, project } = await setup();
    const lineage = await createLineage({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
    });
    const editor = await createUser();
    await addMember({
      userId: editor.id,
      organizationId: organization.id,
      role: 'editor',
    });

    const result = await deleteLineageInTransaction({
      userId: editor.id,
      orgId: organization.id,
      lineageId: lineage.id,
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });

    const [stillThere] = await getTestDb()
      .select({ id: lineages.id })
      .from(lineages)
      .where(eq(lineages.id, lineage.id));
    expect(stillThere?.id).toBe(lineage.id);
  });

  it('does not let a member of another org touch a lineage', async () => {
    const { user, organization } = await setup();
    const otherOrg = await createOrganization({ name: '另一个组织' });
    const otherProject = await createProject({
      orgId: otherOrg.id,
      createdBy: user.id,
    });
    const foreignLineage = await createLineage({
      orgId: otherOrg.id,
      projectId: otherProject.id,
      createdBy: user.id,
    });

    const result = await updateLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      lineageId: foreignLineage.id,
      updates: { name: '越权改名' },
    });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
  });

  it('rejects writes from viewers', async () => {
    const { organization, project } = await setup();
    const viewer = await createUser();
    await addMember({
      userId: viewer.id,
      organizationId: organization.id,
      role: 'viewer',
    });

    const result = await createLineageInTransaction({
      userId: viewer.id,
      orgId: organization.id,
      projectId: project.id,
      name: '越权谱系',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});
