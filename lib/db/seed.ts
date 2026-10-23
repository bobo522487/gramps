import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/better-auth';
import { isAuthErrorCode } from '@/lib/auth/errors';
import { withOrg } from './drizzle';
import { isUniqueViolation } from './errors';
import { organizations, orgMembers, projects } from './schema';

const EMAIL = 'test@test.com';
const PASSWORD = 'admin123';

type SeedUser = { id: string; organizationId: string };

/** Creates or reuses the demo account through Better Auth's own sign-up path. */
async function ensureDemoUser(): Promise<SeedUser> {
  let userId: string;

  try {
    const result = await getAuth().api.signUpEmail({
      body: { email: EMAIL, name: '测试用户', password: PASSWORD },
    });
    userId = result.user.id;
  } catch (error) {
    if (
      !isAuthErrorCode(error, 'USER_ALREADY_EXISTS') &&
      !isUniqueViolation(error)
    ) {
      throw error;
    }

    const result = await getAuth().api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
    });
    userId = result.user.id;
  }

  const organizationId = await withOrg(userId, async (tx) => {
    const rows = await tx
      .select({ organizationId: orgMembers.organizationId })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.organizationId, organizations.id))
      .where(and(eq(orgMembers.userId, userId), eq(orgMembers.role, 'owner')))
      .orderBy(organizations.createdAt)
      .limit(1);
    return rows[0]?.organizationId ?? null;
  });

  if (!organizationId) {
    throw new Error('Demo user exists but has no active organization');
  }

  return { id: userId, organizationId };
}

async function seed() {
  const user = await ensureDemoUser();

  await withOrg(user.id, async (tx) => {
    await tx
      .update(organizations)
      .set({ name: '测试组织' })
      .where(eq(organizations.id, user.organizationId));

    await tx
      .insert(projects)
      .values([
        {
          orgId: user.organizationId,
          ref: 'example0000000000001',
          name: '示例云谱',
          primaryName: '陈寔',
          primarySurname: '陈',
          hallCode: '颍川堂',
          countriesRegions: '中国福建',
          createdBy: user.id,
        },
        {
          orgId: user.organizationId,
          ref: 'branch00000000000001',
          name: '支系档案',
          primaryName: '陈元光',
          primarySurname: '陈',
          hallCode: '漳州堂',
          countriesRegions: '中国漳州',
          createdBy: user.id,
        },
      ])
      .onConflictDoNothing();
  });

  console.log('Demo data ready: test@test.com / admin123');
}

seed()
  .catch((error) => {
    console.error('Seed process failed:', error);
    process.exit(1);
  })
  .finally(() => {
    console.log('Seed process finished. Exiting...');
    process.exit(0);
  });
