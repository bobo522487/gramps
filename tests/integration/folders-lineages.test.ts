import { and, count, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
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
  it('allows three levels and rejects a fourth', async () => {
    const { user, organization, project } = await setup();

    const chain: string[] = [];
    for (let depth = 1; depth <= 3; depth += 1) {
      const result = await createFolderInTransaction({
        userId: user.id,
        orgId: organization.id,
        projectId: project.id,
        kind: 0,
        parentId: chain.at(-1),
        name: `第 ${depth} 层`,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        chain.push(result.folder.id);
      }
    }

    const denied = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      kind: 0,
      parentId: chain[2],
      name: '第 4 层',
    });
    expect(denied).toEqual({ ok: false, reason: 'depth_exceeded' });

    const [row] = await getTestDb()
      .select({ value: count() })
      .from(folders)
      .where(eq(folders.orgId, organization.id));
    expect(row?.value).toBe(3);
  });

  it('soft-deletes the subtree and unfiles content', async () => {
    const { user, organization, project } = await setup();
    const root = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      kind: 0,
      name: '根分类',
    });
    if (!root.ok) {
      throw new Error('failed to create root folder');
    }
    const child = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      kind: 0,
      parentId: root.folder.id,
      name: '子分类',
    });
    if (!child.ok) {
      throw new Error('failed to create child folder');
    }

    const lineage = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: child.folder.id,
      name: '待分类谱系',
      surname: '陈',
    });
    expect(lineage.ok).toBe(true);
    if (!lineage.ok) return;

    const result = await deleteFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      folderId: root.folder.id,
    });
    expect(result).toEqual({
      ok: true,
      deletedFolders: 2,
      unfiledContent: 1,
    });

    const [stored] = await getTestDb()
      .select({ folderId: lineages.folderId })
      .from(lineages)
      .where(eq(lineages.id, lineage.lineage.id));
    expect(stored?.folderId).toBeNull();

    const deleted = await getTestDb()
      .select({ id: folders.id })
      .from(folders)
      .where(
        and(eq(folders.orgId, organization.id), isNull(folders.deletedAt))
      );
    expect(deleted).toHaveLength(0);
  });

  it('unfiles articles and books when their folders are deleted', async () => {
    const { user, organization, project } = await setup();
    const articleFolder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
    });
    const bookFolder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 2,
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
      orgId: organization.id,
      role: 'viewer',
    });

    const result = await createFolderInTransaction({
      userId: viewer.id,
      orgId: organization.id,
      projectId: project.id,
      kind: 0,
      name: '越权分类',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});

describe('lineage service', () => {
  it('creates a lineage in a lineage folder', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolderInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      kind: 0,
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
      surname: '陈',
      hallCode: '颍川堂',
      generationWords: ['元', '亨', '利', '贞'],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.folderId).toBe(folder.folder.id);
    expect(result.lineage.generationWords).toEqual(['元', '亨', '利', '贞']);
  });

  it('rejects a folder from another content tree', async () => {
    const { user, organization, project } = await setup();
    const articleFolder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 1,
    });

    const result = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      folderId: articleFolder.id,
      name: '错分类谱系',
      surname: '陈',
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
      surname: '陈',
    });
    expect(first.ok).toBe(true);

    const second = await createLineageInTransaction({
      userId: user.id,
      orgId: organization.id,
      projectId: project.id,
      name: '重复谱系',
      surname: '陈',
    });
    expect(second).toEqual({ ok: false, reason: 'conflict' });
  });

  it('clears a folder assignment and updates generation words', async () => {
    const { user, organization, project } = await setup();
    const folder = await createFolder({
      orgId: organization.id,
      projectId: project.id,
      createdBy: user.id,
      kind: 0,
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
      updates: { folderId: null, generationWords: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lineage.folderId).toBeNull();
    expect(result.lineage.generationWords).toEqual([]);
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
      bookId: book.id,
      createdBy: user.id,
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
      .where(and(eq(nodes.lineageId, lineage.id), isNull(nodes.deletedAt)));
    expect(active?.value).toBe(0);
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
      orgId: organization.id,
      role: 'viewer',
    });

    const result = await createLineageInTransaction({
      userId: viewer.id,
      orgId: organization.id,
      projectId: project.id,
      name: '越权谱系',
      surname: '陈',
    });
    expect(result).toEqual({ ok: false, reason: 'forbidden' });
  });
});
