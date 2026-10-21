import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/context';
import { getOrgsForUser } from '@/lib/db/queries/organizations';
import { EmptyOrgState } from './empty-org-state';

export default async function DashboardPage() {
  const user = await requireUser();

  const orgs = await getOrgsForUser(user.id);
  if (orgs.length === 0) {
    return <EmptyOrgState />;
  }

  redirect(`/dashboard/org/${orgs[0].organization.slug}`);
}
