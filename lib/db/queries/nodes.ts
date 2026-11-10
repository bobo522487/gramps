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
  courtesy?: string | null;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
  isAlive?: boolean;
};

type PersonFacts = {
  courtesy: string | null;
  birthText: string | null;
  deathText: string | null;
  birthYear: number | null;
  deathYear: number | null;
  burialPlace: string | null;
  isAlive: boolean;
};

const emptyFacts: PersonFacts = {
  courtesy: null,
  birthText: null,
  deathText: null,
  birthYear: null,
  deathYear: null,
  burialPlace: null,
  isAlive: true,
};

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
      courtesy: row.courtesy ?? null,
      namePrefix: null,
      isAlive: row.isAlive ?? true,
      birthText: row.birthText ?? null,
      deathText: row.deathText ?? null,
      birthYear: row.birthYear ?? null,
      deathYear: row.deathYear ?? null,
      burialPlace: row.burialPlace ?? null,
      biography: null,
    };
  });
}

function yearOf(dateSort: string | null): number | null {
  const year = dateSort?.slice(0, 4);
  if (!year || !/^[0-9]{4}$/.test(year)) {
    return null;
  }
  return Number.parseInt(year, 10);
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
    const facts = new Map<string, PersonFacts>();
    if (personIds.length > 0) {
      const eventRows = await tx
        .select({
          personId: events.personId,
          kind: events.kind,
          dateText: events.dateText,
          dateSort: events.dateSort,
          placeText: events.placeText,
        })
        .from(events)
        .where(
          and(
            eq(events.orgId, orgId),
            eq(events.projectId, projectId),
            inArray(events.personId, personIds),
            inArray(events.kind, ['birth', 'death', 'burial'])
          )
        );
      for (const fact of eventRows) {
        if (!fact.personId) {
          continue;
        }
        const entry = facts.get(fact.personId) ?? { ...emptyFacts };
        if (fact.kind === 'birth') {
          entry.birthText = fact.dateText;
          entry.birthYear = yearOf(fact.dateSort);
        } else if (fact.kind === 'death') {
          entry.deathText = fact.dateText;
          entry.deathYear = yearOf(fact.dateSort);
          entry.isAlive = false;
        } else if (fact.kind === 'burial') {
          entry.burialPlace = fact.placeText;
        }
        facts.set(fact.personId, entry);
      }

      const courtesyNames = await tx
        .select({ personId: personNames.personId, value: personNames.value })
        .from(personNames)
        .where(
          and(
            eq(personNames.orgId, orgId),
            eq(personNames.projectId, projectId),
            inArray(personNames.personId, personIds),
            eq(personNames.kind, 'courtesy')
          )
        );
      for (const name of courtesyNames) {
        const entry = facts.get(name.personId) ?? { ...emptyFacts };
        entry.courtesy = name.value;
        facts.set(name.personId, entry);
      }
    }

    return toNodeViewRows(
      rows.map((row) => ({
        ...row,
        ...(row.personId
          ? (facts.get(row.personId) ?? emptyFacts)
          : emptyFacts),
      }))
    );
  });
}
