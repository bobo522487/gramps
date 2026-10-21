import { withApiLogging } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgRole } from '@/lib/auth/permissions';
import { getProjects } from '@/lib/db/queries/projects';

export const GET = withApiLogging(
  'org-projects',
  async (
    _request: Request,
    { params }: { params: Promise<{ orgId: string }> }
  ) => {
    const { orgId } = await params;
    const parsed = Number(orgId);
    const user = await getSessionUser();

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
);
