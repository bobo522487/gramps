// Dev-only CLI entry (`pnpm db:seed`, tsx outside Next): nothing under app/
// imports it, so it is not in the server bundle and must load .env itself.
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { getAuth } from '@/lib/auth/better-auth';
import { withOrg } from './drizzle';
import { organizations, orgMembers, projects } from './schema';

const EMAIL = 'test@test.com';
const PASSWORD = 'admin123';
const ORG_NAME = '测试组织';

type SeedSession = { id: string; headers: Headers };

function sessionCookie(response: Response): string {
  const match = response.headers
    .get('set-cookie')
    ?.match(/better-auth\.session_token=([^;]+)/);
  if (!match) {
    throw new Error(`会话 Cookie 缺失（HTTP ${response.status}）`);
  }
  return `better-auth.session_token=${match[1]}`;
}

/**
 * Signs up the demo account, or signs in when it already exists. Uses Better
 * Auth's own endpoints so the auth schema and personal organization come from
 * the same triggers as production sign-up.
 */
async function openDemoSession(): Promise<SeedSession> {
  const signUp = await getAuth().api.signUpEmail({
    body: { email: EMAIL, name: '测试用户', password: PASSWORD },
    asResponse: true,
  });

  if (signUp.ok) {
    const body = (await signUp.json()) as { user: { id: string } };
    return {
      id: body.user.id,
      headers: new Headers({ cookie: sessionCookie(signUp) }),
    };
  }

  const failure = (await signUp.json().catch(() => null)) as {
    code?: string;
  } | null;
  if (!failure?.code?.startsWith('USER_ALREADY_EXISTS')) {
    throw new Error(`演示账号注册失败（HTTP ${signUp.status}）`);
  }

  const signIn = await getAuth().api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    asResponse: true,
  });
  if (!signIn.ok) {
    throw new Error(`演示账号登录失败（HTTP ${signIn.status}）`);
  }
  const body = (await signIn.json()) as { user: { id: string } };
  return {
    id: body.user.id,
    headers: new Headers({ cookie: sessionCookie(signIn) }),
  };
}

async function findOwnerOrganization(userId: string): Promise<string> {
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
    throw new Error('演示用户没有可用的所有者组织');
  }
  return organizationId;
}

async function seed() {
  const session = await openDemoSession();

  try {
    const organizationId = await findOwnerOrganization(session.id);

    // Organization writes belong to auth_service; go through the owner path.
    await getAuth().api.updateOrganization({
      body: { organizationId, data: { name: ORG_NAME } },
      headers: session.headers,
    });

    await withOrg(session.id, async (tx) => {
      await tx
        .insert(projects)
        .values([
          {
            orgId: organizationId,
            ref: 'example0000000000001',
            name: '示例云谱',
            themeName: '颍川陈氏宗谱',
            surname: '陈',
            hallCode: '颍川堂',
            countriesRegions: '中国福建',
            createdBy: session.id,
          },
          {
            orgId: organizationId,
            ref: 'branch00000000000001',
            name: '支系档案',
            themeName: '漳州陈氏支谱',
            surname: '陈',
            hallCode: '漳州堂',
            countriesRegions: '中国漳州',
            createdBy: session.id,
          },
        ])
        .onConflictDoNothing();
    });
  } finally {
    await getAuth().api.signOut({ headers: session.headers });
  }

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
