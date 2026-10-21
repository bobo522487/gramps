import { hashPassword } from '@/lib/auth/session';
import { db } from './drizzle';
import { organizations, orgMembers, projects, users } from './schema';

async function seed() {
  const email = 'test@test.com';
  const password = 'admin123';
  const passwordHash = await hashPassword(password);

  const [user] = await db
    .insert(users)
    .values([
      {
        email: email,
        passwordHash: passwordHash,
        role: 'owner',
      },
    ])
    .returning();

  console.log('Initial user created.');

  const [org] = await db
    .insert(organizations)
    .values({
      name: '测试组织',
      slug: 'testorg0000000000001',
    })
    .returning();

  await db.insert(orgMembers).values({
    orgId: org.id,
    userId: user.id,
    role: 'owner',
  });

  await db.insert(projects).values([
    {
      orgId: org.id,
      name: '示例家谱',
      slug: 'example-lineage',
      ref: 'docsapi0000000000001',
      region: 'us-east-1',
    },
    {
      orgId: org.id,
      name: '支系档案',
      slug: 'branch-archive',
      ref: 'mobilebackend0000001',
      region: 'eu-west-1',
      status: 'PAUSED',
      health: 'DEGRADED',
    },
  ]);
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
