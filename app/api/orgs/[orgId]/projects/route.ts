import { z } from 'zod';
import { withApiLogging } from '@/lib/api';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgRole } from '@/lib/auth/permissions';
import { getProjects } from '@/lib/db/queries/projects';

const orgIdSchema = z.uuid();

export const GET = withApiLogging(
  'org-projects',
  async (
    _request: Request,
    { params }: { params: Promise<{ orgId: string }> }
  ) => {
    const { orgId } = await params;
    const user = await getSessionUser();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!orgIdSchema.safeParse(orgId).success) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
    // The project list is org-scoped: membership is checked before any read.
    if (!(await getOrgRole(user.id, orgId))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const items = await getProjects(user.id, orgId);
    return Response.json(
      items.map((project) => ({
        id: project.id,
        name: project.name,
        ref: project.ref,
      }))
    );
  }
);
