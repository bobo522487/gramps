import { eq, sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/session';
import { db, queryRows } from './drizzle';
import { isUniqueViolation } from './errors';
import { organizations, projects } from './schema';

const EMAIL = 'test@test.com';
const PASSWORD = 'admin123';

type SeedUser = { id: string; organizationId: string };

/** Creates the demo account through the same atomic path as registration. */
async function ensureDemoUser(): Promise<SeedUser> {
  const passwordHash = await hashPassword(PASSWORD);

  try {
    const rows = await queryRows<{ id: string; defaultOrganizationId: string }>(
      db,
      sql`
        select id, default_organization_id as "defaultOrganizationId"
        from auth.sign_up(${EMAIL}, '测试用户', ${passwordHash}, null, null)
      `
    );
    const user = rows[0];
    if (!user) {
      throw new Error('auth.sign_up returned no user');
    }
    return { id: user.id, organizationId: user.defaultOrganizationId };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const rows = await queryRows<{ id: string; organizationId: string }>(
    db,
    sql`
      select u.id, m.organization_id as "organizationId"
      from auth.users u
      join organization_member m
        on m.user_id = u.id
       and m.role = 'owner'
       and m.deleted_at is null
      where lower(u.email) = lower(${EMAIL}) and u.deleted_at is null
      order by u.created_at
      limit 1
    `
  );
  const user = rows[0];
  if (!user) {
    throw new Error('Demo user exists but has no active organization');
  }
  return user;
}

async function seed() {
  const user = await ensureDemoUser();

  await db
    .update(organizations)
    .set({ name: '测试组织' })
    .where(eq(organizations.id, user.organizationId));

  await db
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
