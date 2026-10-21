import { withApiLogging } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgsForUser } from '@/lib/db/queries/organizations';

async function listOrgs() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const orgs = await getOrgsForUser(user.id);
  return Response.json(
    orgs.map(({ organization, role }) => ({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      role,
    }))
  );
}

export const GET = withApiLogging('orgs', listOrgs);
