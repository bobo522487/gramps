import { eq, isNull } from 'drizzle-orm';
import { generatePublicId } from '@/lib/ids';
import { db } from './drizzle';
import { organizations, projects } from './schema';

const MAX_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505'
  );
}

async function backfillOrgSlugs() {
  const rows = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(isNull(organizations.slug));

  let updated = 0;
  for (const row of rows) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await db
          .update(organizations)
          .set({ slug: generatePublicId() })
          .where(eq(organizations.id, row.id));
        updated++;
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
  }

  return { total: rows.length, updated };
}

async function backfillProjectRefs() {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(isNull(projects.ref));

  let updated = 0;
  for (const row of rows) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        await db
          .update(projects)
          .set({ ref: generatePublicId() })
          .where(eq(projects.id, row.id));
        updated++;
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === MAX_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
  }

  return { total: rows.length, updated };
}

async function backfill() {
  const orgs = await backfillOrgSlugs();
  console.log(
    `Organizations backfilled: ${orgs.updated}/${orgs.total} (rows with NULL slug)`
  );

  const projectRows = await backfillProjectRefs();
  console.log(
    `Projects backfilled: ${projectRows.updated}/${projectRows.total} (rows with NULL ref)`
  );
}

backfill()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exit(1);
  })
  .finally(() => {
    console.log('Backfill process finished. Exiting...');
    process.exit(0);
  });
