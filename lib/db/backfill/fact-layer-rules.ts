// Pure mapping rules from a `node` row to the fact layer: no SQL here, so the
// decisions that lose information are readable and testable on their own.
//
// Everything node cannot express is dropped *declared* (see LossReport) rather
// than fabricated: a year in `birth_year` produces date bounds but no
// `date_original`, a burial place produces `place_original` and no date at all,
// and a blood node carrying `spouse_of_id` is counted instead of being turned
// into a second blood partner, which app.check_family_blood_side() would reject
// with 23514 and abort the whole organization.

export type LossReport = {
  /** Children of a father with more than one recorded spouse. */
  unknownMother: number;
  /** Children of a father with no recorded spouse at all. */
  noMotherAtAll: number;
  /** Nodes whose full_name is blank; they become name_status='unknown'. */
  emptyFullName: number;
  /** birth_text without birth_year: original text, no date bounds. */
  birthTextWithoutYear: number;
  /** death_text without death_year: original text, no date bounds. */
  deathTextWithoutYear: number;
  /**
   * Blood nodes carrying spouse_of_id. ck_node_spouse_has_no_path allows it,
   * but the fact layer can only express a spouse as a role='spouse' node, so
   * the edge is skipped here.
   */
  spouseEdgeOnBloodNode: number;
};

/** A live (not soft-deleted) node joined with the project of its lineage. */
export type LiveNode = {
  id: string;
  project_id: string;
  parent_id: string | null;
  spouse_of_id: string | null;
  role: string;
  sort: number | null;
  name: string;
  surname: string;
  full_name: string;
  sex: number;
  courtesy: string | null;
  name_prefix: string | null;
  is_alive: boolean;
  birth_text: string | null;
  death_text: string | null;
  birth_year: number | null;
  death_year: number | null;
  burial_place: string | null;
  created_by: string;
};

/**
 * One family to create: a blood node, the spouse that shares it (or null for a
 * children-only family), and the children that hang off it.
 */
export type FamilyPlan = {
  blood: LiveNode;
  spouse: LiveNode | null;
  children: LiveNode[];
};

type DateFields = {
  date_original: string | null;
  date_start: string | null;
  date_end: string | null;
  date_precision: string | null;
  date_qualifier: string;
  place_original: string | null;
};

type EventRow = DateFields & {
  organization_id: string;
  project_id: string;
  person_id: string;
  event_type: string;
  created_by: string;
};

export function emptyLossReport(): LossReport {
  return {
    unknownMother: 0,
    noMotherAtAll: 0,
    emptyFullName: 0,
    birthTextWithoutYear: 0,
    deathTextWithoutYear: 0,
    spouseEdgeOnBloodNode: 0,
  };
}

/** Blank and whitespace-only text is not a value; it must not become ''. */
function meaningfulText(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  return value.trim() === '' ? null : value;
}

function bySortThenId(left: LiveNode, right: LiveNode): number {
  const leftSort = left.sort ?? 0;
  const rightSort = right.sort ?? 0;
  if (leftSort !== rightSort) {
    return leftSort - rightSort;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * Map a year typed into `birth_year` / `death_year` onto a date range.
 *
 * `date_original` stays NULL: a year in a numeric column is not original text,
 * and the year is fully carried by the bounds. A year PostgreSQL cannot store
 * in a `date` (0 or out of range) is an error, not a silently dropped fact.
 */
function yearBounds(year: number, nodeId: string, column: string) {
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error(
      `node ${nodeId}: ${column}=${year} is outside the supported range 1..9999`
    );
  }
  const padded = String(year).padStart(4, '0');
  return { start: `${padded}-01-01`, end: `${padded}-12-31` };
}

/**
 * Birth/death date fields. Exactly one of the five date rules in 0021 must
 * hold, and `date_qualifier` is always written explicitly:
 * - year present → 'exact', both bounds, precision 'year';
 * - text only → 'unknown', both bounds NULL.
 */
function datedFields(
  kind: 'birth' | 'death',
  text: string | null,
  year: number | null,
  node: LiveNode,
  lossReport: LossReport
): DateFields | null {
  const original = meaningfulText(text);
  if (year === null) {
    if (original === null) {
      return null;
    }
    if (kind === 'birth') {
      lossReport.birthTextWithoutYear += 1;
    } else {
      lossReport.deathTextWithoutYear += 1;
    }
    return {
      date_original: original,
      date_start: null,
      date_end: null,
      date_precision: null,
      date_qualifier: 'unknown',
      place_original: null,
    };
  }
  const bounds = yearBounds(year, node.id, `${kind}_year`);
  return {
    date_original: original,
    date_start: bounds.start,
    date_end: bounds.end,
    date_precision: 'year',
    date_qualifier: 'exact',
    place_original: null,
  };
}

/**
 * Step 3: derive the families from the blood nodes.
 *
 * node records only "this spouse belongs to that person", never the mother of a
 * child, so a father with several spouses gets one family per spouse and one
 * extra children-only family; the mother of those children is unknown and
 * counted as such.
 */
export function planFamilies(
  nodes: LiveNode[],
  lossReport: LossReport
): FamilyPlan[] {
  const spousesByBloodId = new Map<string, LiveNode[]>();
  const childrenByParentId = new Map<string, LiveNode[]>();
  for (const node of nodes) {
    if (node.role === 'blood' && node.spouse_of_id !== null) {
      lossReport.spouseEdgeOnBloodNode += 1;
    }
    if (node.role === 'spouse' && node.spouse_of_id !== null) {
      const spouses = spousesByBloodId.get(node.spouse_of_id) ?? [];
      spouses.push(node);
      spousesByBloodId.set(node.spouse_of_id, spouses);
    }
    if (node.parent_id !== null) {
      const children = childrenByParentId.get(node.parent_id) ?? [];
      children.push(node);
      childrenByParentId.set(node.parent_id, children);
    }
  }

  const plans: FamilyPlan[] = [];
  for (const blood of nodes) {
    if (blood.role !== 'blood') {
      continue;
    }
    const spouses = (spousesByBloodId.get(blood.id) ?? []).sort(byId);
    const children = (childrenByParentId.get(blood.id) ?? []).sort(
      bySortThenId
    );
    if (spouses.length === 0) {
      if (children.length > 0) {
        plans.push({ blood, spouse: null, children });
        lossReport.noMotherAtAll += children.length;
      }
      continue;
    }
    if (spouses.length === 1) {
      // The only spouse's family is the one the children hang off.
      plans.push({ blood, spouse: spouses[0], children });
      continue;
    }
    for (const spouse of spouses) {
      plans.push({ blood, spouse, children: [] });
    }
    // Several spouses: node does not say which one is the mother.
    plans.push({ blood, spouse: null, children });
    lossReport.unknownMother += children.length;
  }
  return plans;
}

export function personIdOf(
  personIdByNodeId: Map<string, string>,
  nodeId: string
) {
  const personId = personIdByNodeId.get(nodeId);
  if (personId === undefined) {
    throw new Error(`node ${nodeId} has no person row`);
  }
  return personId;
}

/** Step 4: birth, death and burial events for every live node. */
export function planEvents(
  organizationId: string,
  nodes: LiveNode[],
  personIdByNodeId: Map<string, string>,
  lossReport: LossReport
): EventRow[] {
  const events: EventRow[] = [];
  for (const node of nodes) {
    const personId = personIdOf(personIdByNodeId, node.id);
    const base = {
      organization_id: organizationId,
      project_id: node.project_id,
      person_id: personId,
      created_by: node.created_by,
    };
    const birth = datedFields(
      'birth',
      node.birth_text,
      node.birth_year,
      node,
      lossReport
    );
    if (birth !== null) {
      events.push({ ...base, event_type: 'birth', ...birth });
    }
    const death = datedFields(
      'death',
      node.death_text,
      node.death_year,
      node,
      lossReport
    );
    if (death !== null) {
      events.push({ ...base, event_type: 'death', ...death });
    }
    const burialPlace = meaningfulText(node.burial_place);
    if (burialPlace !== null) {
      // node has no burial date at all, so the event carries the place and no
      // date: date_qualifier='unknown' is the only honest value.
      events.push({
        ...base,
        event_type: 'burial',
        date_original: null,
        date_start: null,
        date_end: null,
        date_precision: null,
        date_qualifier: 'unknown',
        place_original: burialPlace,
      });
    }
  }
  return events;
}
