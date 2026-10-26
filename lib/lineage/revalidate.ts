import 'server-only';

import { revalidatePath } from 'next/cache';

/**
 * Invalidation is scoped to the subtree a write can actually change. Before
 * this module every action called `revalidatePath('/dashboard', 'layout')`, so
 * one node edit threw away the whole console's cache.
 *
 * Lineage and folder actions cannot use the scoped helpers yet: their payloads
 * carry only UUIDs (`orgId` / `lineageId`), not the public `orgSlug` /
 * `projectRef` that a path needs. Widening 12 Zod schemas and the six dialogs
 * that submit them is an interface change tracked separately; until then those
 * actions keep the whole-console call through `revalidateWholeConsole()`.
 */

/** A lineage / node / folder write: only this project and its org shell change. */
export function revalidateProject(orgSlug: string, projectRef: string) {
  revalidatePath(`/dashboard/project/${projectRef}`, 'layout');
  revalidatePath(`/dashboard/org/${orgSlug}`, 'layout');
}

/** An organization-scoped write that cannot affect another project's contents. */
export function revalidateOrg(orgSlug: string) {
  revalidatePath(`/dashboard/org/${orgSlug}`, 'layout');
}

/**
 * Membership, org-list and lineage-write invalidation: the root layout reads the
 * caller's orgs and the console switcher, and lineage actions still lack a
 * public path, so these genuinely need the whole console today.
 */
export function revalidateWholeConsole() {
  revalidatePath('/dashboard', 'layout');
}
