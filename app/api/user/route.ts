import { getUser } from '@/lib/db/queries';

export async function GET() {
  const user = await getUser();
  if (!user) {
    return Response.json(null);
  }

  // Never serialize the full users row (credentials, token state, ...).
  return Response.json({ id: user.id, name: user.name, email: user.email });
}
