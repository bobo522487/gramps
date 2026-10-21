import { notFound } from 'next/navigation';
import { ConsoleFrame } from '@/components/console/console-frame';
import { getProjectScopeByRef, getUser } from '@/lib/db/queries';
import { isPublicId } from '@/lib/ids';

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectRef: string }>;
}) {
  const { projectRef } = await params;
  if (!isPublicId(projectRef)) {
    notFound();
  }

  const user = await getUser();
  if (!user) {
    notFound();
  }

  // The join is scoped to the signed-in user, so cross-org refs fall through
  const scope = await getProjectScopeByRef(user.id, projectRef);
  if (!scope) {
    notFound();
  }

  return (
    <ConsoleFrame
      scope={{
        org: {
          id: scope.organization.id,
          name: scope.organization.name,
          slug: scope.organization.slug,
          role: scope.role,
        },
        project: {
          id: scope.project.id,
          name: scope.project.name,
          ref: scope.project.ref,
        },
      }}
    >
      {children}
    </ConsoleFrame>
  );
}
