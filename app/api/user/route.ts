import { withApiLogging } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/context';

async function currentUser() {
  const user = await getSessionUser();
  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Never serialize the full users row (credentials, token state, ...).
  return Response.json({ id: user.id, name: user.name, email: user.email });
}

export const GET = withApiLogging('user', currentUser);
