import 'server-only';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { logActivityInTx } from '@/lib/db/queries/activity';
import {
  ActivityType,
  type Node,
  nodes,
  personNames,
  persons,
} from '@/lib/db/schema';
import type { PersonSex } from '@/lib/genealogy/constants';
import { withCreateWrite, withLineageWrite } from './lineage-write';

/**
 * S8 stage A′ write layer (appendix A.3/A.4).
 *
 * A person is no longer a `node` row carrying identity columns. Creating one
 * is a single transaction over three tables:
 *
 *   `person` (identity + sex) → `person_name` (the primary recorded name)
 *   → `node` (a position reference: person_id + sparse ltree path)
 *
 * The four-creation-path shape is kept so the Server Actions and the UI stay
 * stable, but the fields the target model cannot store are no longer written.
 *
 * Registered degradations (see implementation plan §3.2, stage C follow-ups):
 * - spouse pairing: `node` has no spouse edge; the relationship belongs in
 *   `family` / `family_partner`, whose write layer is not part of A′. The
 *   co-created-spouse input is accepted but not persisted.
 * - whole-subtree move / sibling reorder: `node_parent_fk` is non-deferrable,
 *   so rewriting parent paths needs the phase-B DDL (deferrable FK or a
 *   three-stage prefix swap). These two entry points validate their input and
 *   return an explicit failure instead of writing a broken tree.
 * - the create-idempotency key was retired with the target-model `node`;
 *   replay protection is a stage-C follow-up.
 */

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

/** Kept for form compatibility; no target-model column in A′. */
export type OptionalSpouse = {
  name: string;
  surname: string;
};

/** 谱系写入的失败原因；`lib/lineage/lineage-errors.ts` 逐个映射成中文文案。 */
export type NodeFailure =
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

/**
 * Expands the optional form details into a full shape. The target model keeps
 * these as a stable form contract; the write layer below does not persist them
 * until `person_name` / `event` gain the corresponding rows in stage C.
 */
export function toNodeDetails(
  details: Partial<NodeCreateDetails> | undefined
): NodeCreateDetails {
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

/** Four-digit sparse ltree label; +10 leaves gaps for later insertions. */
const PATH_STEP = 10;

function segment(value: number): string {
  const label = String(value).padStart(4, '0');
  if (label.length !== 4) {
    throw new Error('node path segment overflow');
  }
  return label;
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
        eq(nodes.lineageId, lineageId)
      )
    )
    .limit(1);
  return node ?? null;
}

/**
 * Allocates the next path under `parentPath`: the largest trailing segment in
 * that sibling group plus `PATH_STEP`, padded to four digits. Roots have a
 * NULL `parent_path` (generated column) and are grouped together.
 */
async function nextPath(
  tx: DbTransaction,
  orgId: string,
  lineageId: string,
  parentPath: string | null
): Promise<string> {
  const siblings = await tx
    .select({ path: nodes.path })
    .from(nodes)
    .where(
      and(
        eq(nodes.orgId, orgId),
        eq(nodes.lineageId, lineageId),
        parentPath === null
          ? isNull(nodes.parentPath)
          : sql`${nodes.parentPath} = ${parentPath}::ltree`
      )
    );

  let max = 0;
  for (const sibling of siblings) {
    const last = sibling.path.split('.').at(-1) ?? '0';
    max = Math.max(max, Number.parseInt(last, 10) || 0);
  }
  const leaf = segment(max + PATH_STEP);
  return parentPath === null ? leaf : `${parentPath}.${leaf}`;
}

type WriteContext = {
  userId: string;
  orgId: string;
  projectId: string;
  lineageId: string;
  ipAddress?: string;
};

type CreateInput = {
  name: string;
  surname: string;
  sex: PersonSex;
  parentPath: string | null;
};

/** `person` + `person_name` + `node` in one transaction. */
async function recordNode(
  tx: DbTransaction,
  ctx: WriteContext,
  input: CreateInput
): Promise<Extract<NodeMutationResult, { ok: true }>> {
  const { userId, orgId, projectId, lineageId, ipAddress } = ctx;
  const displayName = input.surname
    ? `${input.surname}${input.name}`
    : input.name;

  const [person] = await tx
    .insert(persons)
    .values({ orgId, projectId, sex: input.sex })
    .returning({ id: persons.id });
  if (!person) {
    throw new Error('failed to insert person');
  }

  await tx.insert(personNames).values({
    orgId,
    projectId,
    personId: person.id,
    kind: 'given',
    value: displayName,
    isPrimary: true,
  });

  const path = await nextPath(tx, orgId, lineageId, input.parentPath);
  const [node] = await tx
    .insert(nodes)
    .values({
      orgId,
      projectId,
      lineageId,
      personId: person.id,
      path,
      kind: 'primary',
      displayName,
    })
    .returning();
  if (!node) {
    throw new Error('failed to insert node');
  }

  await logActivityInTx(tx, userId, orgId, ActivityType.CREATE_NODE, ipAddress);
  return { ok: true as const, node };
}

/** Shared shape for the four creation paths. */
export type NodeCreateParams = {
  userId: string;
  orgId: string;
  lineageId: string;
  name: string;
  surname?: string;
  sex: PersonSex;
  details?: NodeCreateDetails;
  spouse?: OptionalSpouse;
  ipAddress?: string;
};

function createContext(
  params: NodeCreateParams,
  lineage: { projectId: string }
): WriteContext {
  return {
    userId: params.userId,
    orgId: params.orgId,
    projectId: lineage.projectId,
    lineageId: params.lineageId,
    ipAddress: params.ipAddress,
  };
}

export async function createRootNodeInTransaction(
  params: NodeCreateParams
): Promise<NodeMutationResult> {
  return withCreateWrite(params, async (tx, lineage) => {
    const [existing] = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.orgId, params.orgId),
          eq(nodes.lineageId, params.lineageId),
          isNull(nodes.parentPath)
        )
      )
      .limit(1);
    if (existing) {
      return { ok: false, reason: 'root_exists' as const };
    }

    return recordNode(tx, createContext(params, lineage), {
      name: params.name,
      surname: params.surname ?? '',
      sex: params.sex,
      parentPath: null,
    });
  });
}

export async function addChildInTransaction(
  params: NodeCreateParams & { parentId: string }
): Promise<NodeMutationResult> {
  return withCreateWrite(params, async (tx, lineage) => {
    const parent = await loadNode(
      tx,
      params.orgId,
      params.lineageId,
      params.parentId
    );
    if (!parent) {
      return { ok: false, reason: 'not_found' as const };
    }
    return recordNode(tx, createContext(params, lineage), {
      name: params.name,
      surname: params.surname ?? '',
      sex: params.sex,
      parentPath: parent.path,
    });
  });
}

export async function addSiblingInTransaction(
  params: NodeCreateParams & { siblingOfId: string }
): Promise<NodeMutationResult> {
  return withCreateWrite(params, async (tx, lineage) => {
    const sibling = await loadNode(
      tx,
      params.orgId,
      params.lineageId,
      params.siblingOfId
    );
    if (!sibling) {
      return { ok: false, reason: 'not_found' as const };
    }
    if (!sibling.parentPath) {
      return { ok: false, reason: 'root_sibling' as const };
    }
    return recordNode(tx, createContext(params, lineage), {
      name: params.name,
      surname: params.surname ?? '',
      sex: params.sex,
      parentPath: sibling.parentPath,
    });
  });
}

/**
 * Spouse pairing is not representable by a target-model `node` (no spouse
 * edge). The relationship belongs in `family_partner`; until that write layer
 * exists this entry point fails explicitly rather than writing a sibling and
 * calling it a spouse.
 */
export async function addSpouseInTransaction(
  params: Omit<NodeCreateParams, 'spouse'> & { anchorId: string }
): Promise<NodeMutationResult> {
  return withCreateWrite(params, async (tx) => {
    const anchor = await loadNode(
      tx,
      params.orgId,
      params.lineageId,
      params.anchorId
    );
    if (!anchor) {
      return { ok: false, reason: 'not_found' as const };
    }
    return { ok: false, reason: 'invalid_target' as const };
  });
}

export type NodeUpdates = {
  name: string;
  surname: string;
  sex: PersonSex;
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

  return withLineageWrite({ userId, orgId, lineageId }, async (tx, lineage) => {
    const current = await loadNode(tx, orgId, lineageId, nodeId);
    if (!current) {
      return { ok: false, reason: 'not_found' as const };
    }

    const displayName = updates.surname
      ? `${updates.surname}${updates.name}`
      : updates.name;

    if (current.personId) {
      await tx
        .update(persons)
        .set({ sex: updates.sex })
        .where(
          and(
            eq(persons.projectId, lineage.projectId),
            eq(persons.id, current.personId)
          )
        );
      await tx
        .update(personNames)
        .set({ value: displayName })
        .where(
          and(
            eq(personNames.projectId, lineage.projectId),
            eq(personNames.personId, current.personId),
            eq(personNames.isPrimary, true)
          )
        );
    }

    const [node] = await tx
      .update(nodes)
      .set({ displayName })
      .where(
        and(
          eq(nodes.id, nodeId),
          eq(nodes.projectId, lineage.projectId),
          eq(nodes.lineageId, lineageId)
        )
      )
      .returning();

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.UPDATE_NODE,
      ipAddress
    );
    return { ok: true as const, node };
  });
}

export async function deleteNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  ipAddress?: string;
}): Promise<DeleteNodeResult> {
  const { userId, orgId, lineageId, nodeId, ipAddress } = params;

  return withLineageWrite({ userId, orgId, lineageId }, async (tx) => {
    const target = await loadNode(tx, orgId, lineageId, nodeId);
    if (!target) {
      return { ok: false, reason: 'not_found' as const };
    }
    if (!target.parentPath) {
      return { ok: false, reason: 'root_forbidden' as const };
    }

    // Hard delete of the whole subtree. `ON DELETE RESTRICT` on the self
    // reference is the target-model semantics; there is no soft-delete column.
    const deleted = await tx
      .delete(nodes)
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          sql`${nodes.path} <@ ${target.path}::ltree`
        )
      )
      .returning({ id: nodes.id });

    await logActivityInTx(
      tx,
      userId,
      orgId,
      ActivityType.DELETE_NODE,
      ipAddress
    );
    return { ok: true as const, node: target, deletedNodes: deleted.length };
  });
}

/**
 * Moving a subtree requires rewriting every descendant path. The target
 * model's parent foreign key is non-deferrable, so a correct rewrite needs a
 * three-stage temporary prefix swap backed by the phase-B DDL. Until then
 * this validates the target and fails explicitly.
 */
export async function moveNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  newParentId: string;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { orgId, lineageId, nodeId, newParentId } = params;

  return withLineageWrite(params, async (tx) => {
    const node = await loadNode(tx, orgId, lineageId, nodeId);
    if (!node?.parentPath) {
      return { ok: false, reason: 'invalid_target' as const };
    }
    if (node.id === newParentId) {
      return { ok: false, reason: 'invalid_parent' as const };
    }
    const newParent = await loadNode(tx, orgId, lineageId, newParentId);
    if (!newParent) {
      return { ok: false, reason: 'invalid_parent' as const };
    }
    if (
      newParent.path === node.path ||
      newParent.path.startsWith(`${node.path}.`)
    ) {
      return { ok: false, reason: 'cycle' as const };
    }
    return { ok: false, reason: 'invalid_target' as const };
  });
}

/** Sibling order is the trailing path segment; see the move note above. */
export async function reorderSiblingsInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  parentId: string | null;
  orderedIds: string[];
}): Promise<ReorderNodesResult> {
  const { orgId, lineageId, orderedIds } = params;

  return withLineageWrite(params, async (tx) => {
    if (new Set(orderedIds).size !== orderedIds.length) {
      return { ok: false, reason: 'invalid_order' as const };
    }
    if (orderedIds.length === 0) {
      return { ok: true as const };
    }
    const rows = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.lineageId, lineageId),
          inArray(nodes.id, orderedIds)
        )
      );
    if (rows.length !== orderedIds.length) {
      return { ok: false, reason: 'invalid_order' as const };
    }
    return { ok: false, reason: 'invalid_order' as const };
  });
}
