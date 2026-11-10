import 'server-only';

import { and, eq } from 'drizzle-orm';
import type { DbTransaction } from '@/lib/db/drizzle';
import { events, personNames } from '@/lib/db/schema';

/**
 * Person facts that the target model can actually store: `courtesy` lives in
 * `person_name`, dated facts (birth / death) and burial live in `event`.
 * `namePrefix` / `biography` have no target-model column and were removed from
 * the form contract instead of being silently dropped.
 */
export type PersonFactDetails = {
  courtesy?: string | null;
  isAlive?: boolean;
  birthText?: string | null;
  deathText?: string | null;
  birthYear?: number | null;
  deathYear?: number | null;
  burialPlace?: string | null;
};

type PersonFactContext = {
  orgId: string;
  projectId: string;
  personId: string;
};

function nonBlank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function yearText(year: number | null | undefined): string | null {
  return year === null || year === undefined ? null : String(year);
}

async function replaceEvent(
  tx: DbTransaction,
  ctx: PersonFactContext,
  kind: 'birth' | 'death' | 'burial',
  payload: {
    dateText?: string | null;
    dateSort?: string | null;
    placeText?: string | null;
  },
  force = false
) {
  await tx
    .delete(events)
    .where(
      and(
        eq(events.orgId, ctx.orgId),
        eq(events.projectId, ctx.projectId),
        eq(events.personId, ctx.personId),
        eq(events.kind, kind)
      )
    );

  if (!force && !payload.dateText && !payload.dateSort && !payload.placeText) {
    return;
  }

  await tx.insert(events).values({
    orgId: ctx.orgId,
    projectId: ctx.projectId,
    personId: ctx.personId,
    kind,
    dateText: payload.dateText ?? null,
    dateSort: payload.dateSort ?? null,
    placeText: payload.placeText ?? null,
  });
}

/**
 * Writes the form's fact fields in the same transaction as `person` / `node`.
 * `isAlive` is represented by the presence of a death event: unchecking it
 * records an empty death event even when no date is known.
 */
export async function writePersonFacts(
  tx: DbTransaction,
  ctx: PersonFactContext,
  details: PersonFactDetails
) {
  await tx
    .delete(personNames)
    .where(
      and(
        eq(personNames.orgId, ctx.orgId),
        eq(personNames.projectId, ctx.projectId),
        eq(personNames.personId, ctx.personId),
        eq(personNames.kind, 'courtesy')
      )
    );
  const courtesy = nonBlank(details.courtesy);
  if (courtesy) {
    await tx.insert(personNames).values({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      personId: ctx.personId,
      kind: 'courtesy',
      value: courtesy,
      isPrimary: false,
    });
  }

  await replaceEvent(tx, ctx, 'birth', {
    dateText: nonBlank(details.birthText) ?? yearText(details.birthYear),
    dateSort: yearText(details.birthYear),
  });

  if (details.isAlive !== undefined) {
    const hasDeath =
      details.isAlive === false ||
      Boolean(nonBlank(details.deathText)) ||
      (details.deathYear !== null && details.deathYear !== undefined);
    await replaceEvent(
      tx,
      ctx,
      'death',
      {
        dateText: nonBlank(details.deathText) ?? yearText(details.deathYear),
        dateSort: yearText(details.deathYear),
      },
      hasDeath
    );
  }

  await replaceEvent(tx, ctx, 'burial', {
    placeText: nonBlank(details.burialPlace),
  });
}
