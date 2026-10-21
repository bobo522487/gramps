import { getOrgRole } from '@/lib/auth/permissions';
import { getProjects, getUser } from '@/lib/db/queries';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const parsed = Number(orgId);
  const user = await getUser();

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  // The project list is org-scoped: membership is checked before any read.
  if (!(await getOrgRole(user.id, parsed))) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const items = await getProjects(parsed);
  return Response.json(
    items.map((project) => ({
      id: project.id,
      name: project.name,
      ref: project.ref,
      status: project.status,
    }))
  );
}
