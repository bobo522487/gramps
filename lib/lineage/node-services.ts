import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { type Node, nodes, personNames, persons } from '@/lib/db/schema';
import type { PersonSex } from '@/lib/genealogy/constants';
import { deleteUnreferencedPersons } from './delete-facts';
import { withLineageWrite } from './lineage-write';
import { writePersonFacts } from './person-facts';

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
  isAlive?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
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
  | 'invalid_order'
  | 'not_supported';

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
 * Expands the optional form details into a full shape. Only fields the target
 * model can store remain in the contract; `namePrefix` / `biography` were
 * removed rather than accepted and dropped.
 */
export function toNodeDetails(
  details: Partial<NodeCreateDetails> | undefined
): NodeCreateDetails {
  return {
    courtesy: details?.courtesy ?? null,
    isAlive: details?.isAlive ?? false,
    birthText: details?.birthText ?? null,
    deathText: details?.deathText ?? null,
    birthYear: details?.birthYear ?? null,
    deathYear: details?.deathYear ?? null,
    burialPlace: details?.burialPlace ?? null,
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
  // The trailing segment is the sibling order. Let PostgreSQL return the
  // maximum label instead of pulling every sibling row into Node.
  const [row] = await tx
    .select({
      max: sql<
        string | null
      >`max(split_part(${nodes.path}::text, '.', nlevel(${nodes.path})))`,
    })
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

  const max = Number.parseInt(row?.max ?? '0', 10) || 0;
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
  details?: NodeCreateDetails;
};

/** `person` + `person_name` + `node` in one transaction. */
async function recordNode(
  tx: DbTransaction,
  ctx: WriteContext,
  input: CreateInput
): Promise<Extract<NodeMutationResult, { ok: true }>> {
  const { orgId, projectId, lineageId } = ctx;
  const surname = input.surname.trim();

  const [person] = await tx
    .insert(persons)
    .values({
      orgId,
      projectId,
      sex: input.sex,
      surname: surname || null,
    })
    .returning({ id: persons.id });
  if (!person) {
    throw new Error('failed to insert person');
  }

  await tx.insert(personNames).values({
    orgId,
    projectId,
    personId: person.id,
    kind: 'given',
    value: input.name,
    isPrimary: true,
  });

  await writePersonFacts(
    tx,
    { orgId, projectId, personId: person.id },
    input.details ?? {}
  );

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
    })
    .returning();
  if (!node) {
    throw new Error('failed to insert node');
  }

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
  return withLineageWrite(params, async (tx, lineage) => {
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
      details: params.details,
      parentPath: null,
    });
  });
}

export async function addChildInTransaction(
  params: NodeCreateParams & { parentId: string }
): Promise<NodeMutationResult> {
  return withLineageWrite(params, async (tx, lineage) => {
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
      details: params.details,
      parentPath: parent.path,
    });
  });
}

export async function addSiblingInTransaction(
  params: NodeCreateParams & { siblingOfId: string }
): Promise<NodeMutationResult> {
  return withLineageWrite(params, async (tx, lineage) => {
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
      details: params.details,
      parentPath: sibling.parentPath,
    });
  });
}

/**
 * Spouse pairing needs `family_partner`; that write layer does not exist yet.
 * Fail with an explicit `not_supported` before doing any reads, so the UI no
 * longer blames the user's chosen anchor.
 */
export async function addSpouseInTransaction(
  params: Omit<NodeCreateParams, 'spouse'> & { anchorId: string }
): Promise<NodeMutationResult> {
  return withLineageWrite(params, async () => {
    return { ok: false, reason: 'not_supported' as const };
  });
}

export type NodeUpdates = {
  name: string;
  surname: string;
  sex: PersonSex;
  courtesy?: string | null;
  isAlive?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
};

export async function updateNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  updates: NodeUpdates;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  const { userId, orgId, lineageId, nodeId, updates } = params;

  return withLineageWrite({ userId, orgId, lineageId }, async (tx, lineage) => {
    const current = await loadNode(tx, orgId, lineageId, nodeId);
    if (!current) {
      return { ok: false, reason: 'not_found' as const };
    }

    const surname = updates.surname.trim();

    if (current.personId) {
      await tx
        .update(persons)
        .set({ sex: updates.sex, surname: surname || null })
        .where(
          and(
            eq(persons.projectId, lineage.projectId),
            eq(persons.id, current.personId)
          )
        );
      await tx
        .update(personNames)
        .set({ value: updates.name })
        .where(
          and(
            eq(personNames.projectId, lineage.projectId),
            eq(personNames.personId, current.personId),
            eq(personNames.isPrimary, true)
          )
        );
      await writePersonFacts(
        tx,
        {
          orgId,
          projectId: lineage.projectId,
          personId: current.personId,
        },
        updates
      );
    }

    return { ok: true as const, node: current };
  });
}

export async function deleteNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  ipAddress?: string;
}): Promise<DeleteNodeResult> {
  const { userId, orgId, lineageId, nodeId } = params;

  return withLineageWrite({ userId, orgId, lineageId }, async (tx, lineage) => {
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
      .returning({ id: nodes.id, personId: nodes.personId });

    await deleteUnreferencedPersons(
      tx,
      { orgId, projectId: lineage.projectId },
      deleted.flatMap((row) => (row.personId ? [row.personId] : []))
    );

    return { ok: true as const, node: target, deletedNodes: deleted.length };
  });
}

/**
 * Moving a subtree requires rewriting every descendant path; the non-deferrable
 * parent FK cannot express that yet. Fail with `not_supported` instead of
 * running validations only to reject a valid target.
 */
export async function moveNodeInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  nodeId: string;
  newParentId: string;
  ipAddress?: string;
}): Promise<NodeMutationResult> {
  return withLineageWrite(params, async () => {
    return { ok: false, reason: 'not_supported' as const };
  });
}

/** Sibling reorder has the same path-rewrite dependency as move. */
export async function reorderSiblingsInTransaction(params: {
  userId: string;
  orgId: string;
  lineageId: string;
  parentId: string | null;
  orderedIds: string[];
}): Promise<ReorderNodesResult> {
  return withLineageWrite(params, async () => {
    return { ok: false, reason: 'not_supported' as const };
  });
}
