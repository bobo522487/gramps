import { notFound } from 'next/navigation';
import { ConsoleFrame } from '@/components/console/console-frame';
import { getOrgWithRoleBySlug, getUser } from '@/lib/db/queries';
import { isPublicId } from '@/lib/ids';

export default async function OrgWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  if (!isPublicId(orgSlug)) {
    notFound();
  }

  const user = await getUser();
  if (!user) {
    notFound();
  }

  const scope = await getOrgWithRoleBySlug(user.id, orgSlug);
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
      }}
    >
      {children}
    </ConsoleFrame>
  );
}
