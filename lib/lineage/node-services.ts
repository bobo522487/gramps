import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type DbTransaction, queryRows } from '@/lib/db/drizzle';
import { logActivityInTx } from '@/lib/db/queries/activity';
import {
  ActivityType,
  type Lineage,
  lineages,
  type Node,
  nodes,
} from '@/lib/db/schema';
import { withOrgWrite } from '@/lib/db/write';

export type NodeCreateDetails = {
  courtesy?: string | null;
  namePrefix?: string | null;
  isAlive?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
  biography?: string | null;
};

/** A spouse recorded in the same transaction as the blood node. */
export type OptionalSpouse = {
  name: string;
  surname: string;
};

type NodeFailure =
  | 'forbidden'
  | 'not_found'
  | 'invalid_target'
  | 'invalid_parent'
  | 'root_exists'
  | 'root_sibling'
  | 'root_forbidden'
  | 'cycle'
  | 'invalid_order';

export type NodeMutationResult =
  | { ok: true; node: Node; spouse?: Node }
  | { ok: false; reason: NodeFailure };

export type DeleteNodeResult =
  | { ok: true; node: Node; deletedNodes: number }
  | { ok: false; reason: NodeFailure };

export type ReorderNodesResult =
  | { ok: true }
  | { ok: false; reason: NodeFailure };

function nodeLabel(id: string) {
  return id.replaceAll('-', '');
}

/** The path needs the id before insert, so ask the database for a UUIDv7. */
async function newNodeId(tx: DbTransaction): Promise<string> {
  const rows = await queryRows<{ id: string }>(tx, sql`select uuidv7() as id`);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('failed to generate node id');
  }
  return id;
}

function fullName(surname: string, name: string) {
  return `${surname}${name}`;
}

/** Locks the lineage row so node count and root checks stay serialized. */
async function loadLineageForUpdate(
  tx: DbTransaction,
  orgId: string,
  lineageId: string
): Promise<Lineage | null> {
  const [lineage] = await tx
    .select()
    .from(lineages)
    .where(
      and(
        eq(lineages.id, lineageId),
        eq(lineages.orgId, orgId),
        isNull(lineages.deletedAt)
      )
    )
    .for('update')
    .limit(1);
  return lineage ?? null;
}

async function loadNode(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  nodeId: string
): Promise<Node | null> {
  const [node] = await tx
    .select()
    .from(nodes)
    .where(
      and(
        eq(nodes.id, nodeId),
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        isNull(nodes.deletedAt)
      )
    )
    .limit(1);
  return node ?? null;
}

async function nextBloodSort(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  parentId: string | null
) {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${nodes.sort}), -1)::int` })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        eq(nodes.role, 'blood'),
        parentId ? eq(nodes.parentId, parentId) : isNull(nodes.parentId),
        isNull(nodes.deletedAt)
      )
    );
  return (row?.value ?? -1) + 1;
}

async function nextSpouseSort(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  spouseOfId: string
) {
  const [row] = await tx
    .select({ value: sql<number>`coalesce(max(${nodes.sort}), -1)::int` })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        eq(nodes.role, 'spouse'),
        eq(nodes.spouseOfId, spouseOfId),
        isNull(nodes.deletedAt)
      )
    );
  return (row?.value ?? -1) + 1;
}

async function adjustNodeCount(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  delta: number
) {
  await tx
    .update(lineages)
    .set({
      nodeCount: sql`greatest(${lineages.nodeCount} + ${delta}, 0)`,
      updatedAt: new Date(),
    })
    .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)));
}

async function insertNode(
  tx: DbTransaction,
  values: typeof nodes.$inferInsert
): Promise<Node> {
  const [node] = await tx.insert(nodes).values(values).returning();
  return node;
}

function detailValues(details: NodeCreateDetails | undefined) {
  return {
    courtesy: details?.courtesy ?? null,
    namePrefix: details?.namePrefix ?? null,
    isAlive: details?.isAlive ?? false,
    birthText: details?.birthText ?? null,
    deathText: details?.deathText ?? null,
    birthYear: details?.birthYear ?? null,
    deathYear: details?.deathYear ?? null,
    burialPlace: details?.burialPlace ?? null,
    biography: details?.biography ?? null,
  };
}

async function insertCoSpouse(
  tx: DbTransaction,
  params: {
    userId: string;
    orgId: string;
    lineageId: string;
    blood: Node;
    spouse: OptionalSpouse;
  }
): Promise<Node> {
  const { userId, orgId, lineageId, blood, spouse } = params;
  const id = await newNodeId(tx);
  return insertNode(tx, {
    id,
    orgId,
    lineageId,
    parentId: null,
    spouseOfId: blood.id,
    role: 'spouse',
    path: null,
    depth: blood.depth,
    generation: blood.generation,
    sort: await nextSpouseSort(tx, orgId, lineageId, blood.id),
    name: spouse.name,
    surname: spouse.surname,
    fullName: fullName(spouse.surname, spouse.name),
    sex: blood.sex === 0 ? 1 : 0,
    isAlive: blood.isAlive,
    createdBy: userId,
  });
}

export async function createRootNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  name: string;
  surname?: string;
  sex: number;
  details?: NodeCreateDetails;
  spouse?: OptionalSpouse;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, name, sex, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }

      const [existing] = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(
          and(
            eq(nodes.orgId, orgId),
            eq(nodes.lineageId, lineageId),
            eq(nodes.role, 'blood'),
            isNull(nodes.deletedAt)
          )
        )
        .limit(1);
      if (existing) {
        return { ok: false, reason: 'root_exists' as const };
      }

      const surname = params.surname ?? lineage.surname;
      const id = await newNodeId(tx);
      const node = await insertNode(tx, {
        id,
        orgId,
        lineageId,
        role: 'blood',
        path: nodeLabel(id),
        depth: 0,
        generation: 1,
        sort: 0,
        name,
        surname,
        fullName: fullName(surname, name),
        sex,
        ...detailValues(params.details),
        createdBy: userId,
      });
      const spouse = params.spouse
        ? await insertCoSpouse(tx, {
            userId,
            orgId,
            lineageId,
            blood: node,
            spouse: params.spouse,
          })
        : null;

      await adjustNodeCount(tx, orgId, lineageId, spouse ? 2 : 1);
      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.CREATE_NODE,
        ipAddress
      );
      return { ok: true as const, node, ...(spouse ? { spouse } : {}) };
    }
  );
}

export async function addChildInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  parentId: string;
  name: string;
  surname?: string;
  sex: number;
  details?: NodeCreateDetails;
  spouse?: OptionalSpouse;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, parentId, name, sex, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const parent = await loadNode(tx, orgId, lineageId, parentId);
      if (!parent) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (parent.role !== 'blood' || !parent.path) {
        return { ok: false, reason: 'invalid_parent' as const };
      }

      const surname = params.surname ?? lineage.surname;
      const id = await newNodeId(tx);
      const node = await insertNode(tx, {
        id,
        orgId,
        lineageId,
        parentId: parent.id,
        role: 'blood',
        path: `${parent.path}.${nodeLabel(id)}`,
        depth: parent.depth + 1,
        generation: parent.generation + 1,
        sort: await nextBloodSort(tx, orgId, lineageId, parent.id),
        name,
        surname,
        fullName: fullName(surname, name),
        sex,
        ...detailValues(params.details),
        createdBy: userId,
      });
      const spouse = params.spouse
        ? await insertCoSpouse(tx, {
            userId,
            orgId,
            lineageId,
            blood: node,
            spouse: params.spouse,
          })
        : null;

      await adjustNodeCount(tx, orgId, lineageId, spouse ? 2 : 1);
      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.CREATE_NODE,
        ipAddress
      );
      return { ok: true as const, node, ...(spouse ? { spouse } : {}) };
    }
  );
}

export async function addSiblingInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  siblingOfId: string;
  name: string;
  surname?: string;
  sex: number;
  details?: NodeCreateDetails;
  spouse?: OptionalSpouse;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, siblingOfId, name, sex, ipAddress } =
    params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const sibling = await loadNode(tx, orgId, lineageId, siblingOfId);
      if (!sibling) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (sibling.role !== 'blood' || !sibling.path) {
        return { ok: false, reason: 'invalid_target' as const };
      }
      if (!sibling.parentId) {
        return { ok: false, reason: 'root_sibling' as const };
      }
      const parent = await loadNode(tx, orgId, lineageId, sibling.parentId);
      if (!parent?.path) {
        return { ok: false, reason: 'invalid_parent' as const };
      }

      const surname = params.surname ?? lineage.surname;
      const id = await newNodeId(tx);
      const node = await insertNode(tx, {
        id,
        orgId,
        lineageId,
        parentId: parent.id,
        role: 'blood',
        path: `${parent.path}.${nodeLabel(id)}`,
        depth: sibling.depth,
        generation: sibling.generation,
        sort: await nextBloodSort(tx, orgId, lineageId, parent.id),
        name,
        surname,
        fullName: fullName(surname, name),
        sex,
        ...detailValues(params.details),
        createdBy: userId,
      });
      const spouse = params.spouse
        ? await insertCoSpouse(tx, {
            userId,
            orgId,
            lineageId,
            blood: node,
            spouse: params.spouse,
          })
        : null;

      await adjustNodeCount(tx, orgId, lineageId, spouse ? 2 : 1);
      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.CREATE_NODE,
        ipAddress
      );
      return { ok: true as const, node, ...(spouse ? { spouse } : {}) };
    }
  );
}

export async function addSpouseInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  spouseOfId: string;
  name: string;
  surname?: string;
  sex: number;
  details?: NodeCreateDetails;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, spouseOfId, name, sex, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const spouseOf = await loadNode(tx, orgId, lineageId, spouseOfId);
      if (!spouseOf) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (spouseOf.role !== 'blood' || !spouseOf.path) {
        return { ok: false, reason: 'invalid_target' as const };
      }

      const surname = params.surname ?? spouseOf.surname;
      const id = await newNodeId(tx);
      const node = await insertNode(tx, {
        id,
        orgId,
        lineageId,
        parentId: null,
        spouseOfId: spouseOf.id,
        role: 'spouse',
        path: null,
        depth: spouseOf.depth,
        generation: spouseOf.generation,
        sort: await nextSpouseSort(tx, orgId, lineageId, spouseOf.id),
        name,
        surname,
        fullName: fullName(surname, name),
        sex,
        ...detailValues(params.details),
        createdBy: userId,
      });

      await adjustNodeCount(tx, orgId, lineageId, 1);
      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.CREATE_NODE,
        ipAddress
      );
      return { ok: true as const, node };
    }
  );
}

export type NodeUpdates = {
  name: string;
  surname: string;
  sex: number;
  courtesy?: string | null;
  namePrefix?: string | null;
  isAlive?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
  biography?: string | null;
};

export async function updateNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  updates: NodeUpdates;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, nodeId, updates, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const current = await loadNode(tx, orgId, lineageId, nodeId);
      if (!current) {
        return { ok: false, reason: 'not_found' as const };
      }

      const [node] = await tx
        .update(nodes)
        .set({
          name: updates.name,
          surname: updates.surname,
          sex: updates.sex,
          fullName: fullName(updates.surname, updates.name),
          ...(updates.courtesy !== undefined
            ? { courtesy: updates.courtesy }
            : {}),
          ...(updates.namePrefix !== undefined
            ? { namePrefix: updates.namePrefix }
            : {}),
          ...(updates.isAlive !== undefined
            ? { isAlive: updates.isAlive }
            : {}),
          ...(updates.birthText !== undefined
            ? { birthText: updates.birthText }
            : {}),
          ...(updates.deathText !== undefined
            ? { deathText: updates.deathText }
            : {}),
          ...(updates.birthYear !== undefined
            ? { birthYear: updates.birthYear }
            : {}),
          ...(updates.deathYear !== undefined
            ? { deathYear: updates.deathYear }
            : {}),
          ...(updates.burialPlace !== undefined
            ? { burialPlace: updates.burialPlace }
            : {}),
          ...(updates.biography !== undefined
            ? { biography: updates.biography }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(nodes.id, nodeId))
        .returning();

      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.UPDATE_NODE,
        ipAddress
      );
      return { ok: true as const, node };
    }
  );
}

export async function deleteNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  ipAddress?: string;
}): Promise<DeleteNodeResult> {
  const { userId, orgId, lineageId, nodeId, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const target = await loadNode(tx, orgId, lineageId, nodeId);
      if (!target) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (target.role === 'blood' && !target.parentId) {
        return { ok: false, reason: 'root_forbidden' as const };
      }

      const ids = new Set<string>([target.id]);

      if (target.role === 'blood' && target.path) {
        const bloodRows = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(
            and(
              eq(nodes.orgId, orgId),
              eq(nodes.lineageId, lineageId),
              eq(nodes.role, 'blood'),
              isNull(nodes.deletedAt),
              sql`${nodes.path} <@ ${target.path}::ltree`
            )
          );
        for (const row of bloodRows) {
          ids.add(row.id);
        }

        const bloodIds = [...ids];
        const spouseRows = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(
            and(
              eq(nodes.orgId, orgId),
              eq(nodes.lineageId, lineageId),
              eq(nodes.role, 'spouse'),
              inArray(nodes.spouseOfId, bloodIds),
              isNull(nodes.deletedAt)
            )
          );
        for (const row of spouseRows) {
          ids.add(row.id);
        }
      }

      const deleted = await tx
        .update(nodes)
        .set({ deletedAt: new Date() })
        .where(inArray(nodes.id, [...ids]))
        .returning({ id: nodes.id });

      await adjustNodeCount(tx, orgId, lineageId, -deleted.length);
      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.DELETE_NODE,
        ipAddress
      );

      return { ok: true as const, node: target, deletedNodes: deleted.length };
    }
  );
}

export async function moveNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  newParentId: string;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, nodeId, newParentId, ipAddress } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      const node = await loadNode(tx, orgId, lineageId, nodeId);
      if (!node) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (node.role !== 'blood' || !node.path) {
        return { ok: false, reason: 'invalid_target' as const };
      }
      if (!node.parentId) {
        return { ok: false, reason: 'invalid_target' as const };
      }
      if (node.id === newParentId) {
        return { ok: false, reason: 'invalid_parent' as const };
      }

      const newParent = await loadNode(tx, orgId, lineageId, newParentId);
      if (!newParent?.path || newParent.role !== 'blood') {
        return { ok: false, reason: 'invalid_parent' as const };
      }
      if (
        newParent.path === node.path ||
        newParent.path.startsWith(`${node.path}.`)
      ) {
        return { ok: false, reason: 'cycle' as const };
      }

      const newPrefix = `${newParent.path}.${nodeLabel(node.id)}`;
      const depthDelta = newParent.depth + 1 - node.depth;
      const generationDelta = newParent.generation + 1 - node.generation;
      const sort = await nextBloodSort(tx, orgId, lineageId, newParent.id);

      // Spouses keep a null path but follow the generation of the blood node
      // they are attached to, so collect the moving subtree before paths change.
      const movingBlood = await tx
        .select({ id: nodes.id })
        .from(nodes)
        .where(
          and(
            eq(nodes.orgId, orgId),
            eq(nodes.lineageId, lineageId),
            eq(nodes.role, 'blood'),
            isNull(nodes.deletedAt),
            sql`${nodes.path} <@ ${node.path}::ltree`
          )
        );

      await tx.execute(sql`
      update ${nodes}
      set path = (${newPrefix}::ltree || subpath(${nodes.path}, nlevel(${node.path}::ltree)))::ltree,
          depth = ${nodes.depth} + ${depthDelta},
          generation = ${nodes.generation} + ${generationDelta},
          updated_at = now()
      where ${nodes.orgId} = ${orgId}
        and ${nodes.lineageId} = ${lineageId}
        and ${nodes.deletedAt} is null
        and ${nodes.path} <@ ${node.path}::ltree
        and ${nodes.id} <> ${node.id}
    `);

      const [updated] = await tx
        .update(nodes)
        .set({
          parentId: newParent.id,
          sort,
          path: newPrefix,
          depth: node.depth + depthDelta,
          generation: node.generation + generationDelta,
          updatedAt: new Date(),
        })
        .where(eq(nodes.id, node.id))
        .returning();

      if (
        movingBlood.length > 0 &&
        (depthDelta !== 0 || generationDelta !== 0)
      ) {
        await tx
          .update(nodes)
          .set({
            depth: sql`${nodes.depth} + ${depthDelta}`,
            generation: sql`${nodes.generation} + ${generationDelta}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(nodes.orgId, orgId),
              eq(nodes.lineageId, lineageId),
              eq(nodes.role, 'spouse'),
              inArray(
                nodes.spouseOfId,
                movingBlood.map((row) => row.id)
              ),
              isNull(nodes.deletedAt)
            )
          );
      }

      await tx
        .update(lineages)
        .set({ updatedAt: new Date() })
        .where(eq(lineages.id, lineageId));

      await logActivityInTx(
        tx,
        userId,
        orgId,
        ActivityType.MOVE_NODE,
        ipAddress
      );
      return { ok: true as const, node: updated };
    }
  );
}

export async function reorderSiblingsInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  parentId: string | null;
  orderedIds: string[];
}): Promise<ReorderNodesResult> {
  const { userId, orgId, lineageId, parentId, orderedIds } = params;

  return withOrgWrite(
    { userId, orgId, permission: 'lineage.write' },
    async (tx) => {
      const lineage = await loadLineageForUpdate(tx, orgId, lineageId);
      if (!lineage) {
        return { ok: false, reason: 'not_found' as const };
      }
      if (new Set(orderedIds).size !== orderedIds.length) {
        return { ok: false, reason: 'invalid_order' as const };
      }
      if (orderedIds.length === 0) {
        return { ok: true as const };
      }

      const rows = await tx
        .select({
          id: nodes.id,
          parentId: nodes.parentId,
          role: nodes.role,
        })
        .from(nodes)
        .where(
          and(
            eq(nodes.orgId, orgId),
            eq(nodes.lineageId, lineageId),
            inArray(nodes.id, orderedIds),
            isNull(nodes.deletedAt)
          )
        );

      if (rows.length !== orderedIds.length) {
        return { ok: false, reason: 'invalid_order' as const };
      }
      const sameParent = rows.every(
        (row) =>
          row.role === 'blood' &&
          (parentId === null
            ? row.parentId === null
            : row.parentId === parentId)
      );
      if (!sameParent) {
        return { ok: false, reason: 'invalid_order' as const };
      }

      for (const [index, id] of orderedIds.entries()) {
        await tx.update(nodes).set({ sort: index }).where(eq(nodes.id, id));
      }
      return { ok: true as const };
    }
  );
}
