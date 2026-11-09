import 'server-only';

import { and, asc, eq, inArray } from 'drizzle-orm';
import { withOrg } from '../drizzle';
import { events, lineages, nodes, personNames, persons } from '../schema';

/**
 * The client-facing projection contract (S8 stage A′ decision D2).
 *
 * Target-model `node` is a position reference only — it has no identity
 * columns. The genealogy canvas, inspector and forms still consume the stable
 * 22-field `NodeView` shape from `components/lineage/types.ts`, so the server
 * assembles that shape here from `person` / `person_name` / `event`. This type
 * is declared locally instead of importing from a client module, keeping the
 * server → client dependency direction clean; it matches structurally.
 */
export type NodeViewRow = {
  id: string;
  parentId: string | null;
  spouseOfId: string | null;
  role: string;
  generation: number;
  sort: number;
  name: string;
  surname: string;
  fullName: string;
  sex: number;
  courtesy: string | null;
  namePrefix: string | null;
  isAlive: boolean;
  birthText: string | null;
  deathText: string | null;
  birthYear: number | null;
  deathYear: number | null;
  burialPlace: string | null;
  biography: string | null;
};

/** One `node` row plus the fact columns joined for the projection. */
export type NodeProjectionInput = {
  id: string;
  path: string;
  parentPath: string | null;
  kind: string;
  displayName: string | null;
  sex: string | null;
  primaryName: string | null;
  birthText?: string | null;
  deathText?: string | null;
};

const emptyDates = { birthText: null, deathText: null };

/**
 * Fact layer → NodeView projection. This is the single place where tree
 * geometry becomes the display fields the canvas expects:
 *
 * - `generation` is `nlevel(path)`, i.e. the number of sparse ltree segments;
 * - `sort` is the trailing four-digit segment, which is the sibling order;
 * - `parentId` is resolved from the generated `parent_path` back to the row
 *   with that exact path in the same tree;
 * - `fullName` comes from the primary `person_name.value`, falling back to the
 *   node's own `display_name`; the surname/given split is a display heuristic
 *   until the client has a dedicated name editor;
 * - `sex` maps the target `person.sex` domain onto the legacy 0/1 view flag;
 * - the remaining identity fields have no target-model column yet and are
 *   filled with neutral values so the UI contract stays stable.
 */
export function toNodeViewRows(rows: NodeProjectionInput[]): NodeViewRow[] {
  const idByPath = new Map(rows.map((row) => [row.path, row.id]));
  return rows.map((row) => {
    const segments = row.path.split('.');
    const fullName = row.primaryName ?? row.displayName ?? '';
    const surname = fullName.length > 1 ? fullName.slice(0, -1) : '';
    const name = fullName ? fullName.slice(-1) : '';
    return {
      id: row.id,
      parentId: row.parentPath ? (idByPath.get(row.parentPath) ?? null) : null,
      spouseOfId: null,
      // The canvas still branches on the legacy `blood`/`spouse` role to walk
      // a subtree for the delete confirmation. Target-model nodes have no
      // spouse edge, so every row is projected as a blood node.
      role: 'blood',
      generation: segments.length,
      sort: Number.parseInt(segments.at(-1) ?? '0', 10) || 0,
      name,
      surname,
      fullName,
      sex: row.sex === 'male' ? 1 : 0,
      courtesy: null,
      namePrefix: null,
      isAlive: true,
      birthText: row.birthText ?? emptyDates.birthText,
      deathText: row.deathText ?? emptyDates.deathText,
      birthYear: null,
      deathYear: null,
      burialPlace: null,
      biography: null,
    };
  });
}

/**
 * Reads one tree as client-ready views. Explicit columns only: target-model
 * `node` has no tenant-immutability or soft-delete columns to filter on, and
 * spreading `select()` would leak the internal path columns to the browser.
 */
export async function getNodes(
  userId: string,
  orgId: string,
  lineageId: string
): Promise<NodeViewRow[]> {
  return withOrg(userId, async (tx) => {
    // Target-model ids are unique only inside `(project_id, id)`, so orgId +
    // lineageId is not a complete scope. Resolve the project once and carry it
    // into every fact-layer read below.
    const [scope] = await tx
      .select({ projectId: lineages.projectId })
      .from(lineages)
      .where(and(eq(lineages.id, lineageId), eq(lineages.orgId, orgId)))
      .limit(1);
    if (!scope) {
      return [];
    }
    const projectId = scope.projectId;

    const rows = await tx
      .select({
        id: nodes.id,
        path: nodes.path,
        parentPath: nodes.parentPath,
        kind: nodes.kind,
        displayName: nodes.displayName,
        personId: nodes.personId,
        sex: persons.sex,
        primaryName: personNames.value,
        createdAt: nodes.createdAt,
      })
      .from(nodes)
      .leftJoin(
        persons,
        and(
          eq(persons.projectId, nodes.projectId),
          eq(persons.id, nodes.personId)
        )
      )
      .leftJoin(
        personNames,
        and(
          eq(personNames.projectId, nodes.projectId),
          eq(personNames.personId, nodes.personId),
          eq(personNames.isPrimary, true)
        )
      )
      .where(
        and(
          eq(nodes.orgId, orgId),
          eq(nodes.projectId, projectId),
          eq(nodes.lineageId, lineageId)
        )
      )
      // `path` is a sparse numeric ltree now, so a lexicographic order is the
      // tree's preorder — no separate sort column is needed.
      .orderBy(asc(nodes.path), asc(nodes.createdAt), asc(nodes.id));

    const personIds = [
      ...new Set(
        rows
          .map((row) => row.personId)
          .filter((id): id is string => id !== null)
      ),
    ];
    const dates = new Map<
      string,
      { birthText: string | null; deathText: string | null }
    >();
    if (personIds.length > 0) {
      const facts = await tx
        .select({
          personId: events.personId,
          kind: events.kind,
          dateText: events.dateText,
        })
        .from(events)
        .where(
          and(
            eq(events.orgId, orgId),
            eq(events.projectId, projectId),
            inArray(events.personId, personIds),
            inArray(events.kind, ['birth', 'death'])
          )
        );
      for (const fact of facts) {
        if (!fact.personId) {
          continue;
        }
        const entry = dates.get(fact.personId) ?? { ...emptyDates };
        if (fact.kind === 'birth') {
          entry.birthText = fact.dateText;
        } else if (fact.kind === 'death') {
          entry.deathText = fact.dateText;
        }
        dates.set(fact.personId, entry);
      }
    }

    return toNodeViewRows(
      rows.map((row) => ({
        ...row,
        ...(row.personId
          ? (dates.get(row.personId) ?? emptyDates)
          : emptyDates),
      }))
    );
  });
}
