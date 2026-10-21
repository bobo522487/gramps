import { redirect } from 'next/navigation';
import { getOrgsForUser, getUser } from '@/lib/db/queries';
import { EmptyOrgState } from './empty-org-state';

export default async function DashboardPage() {
  const user = await getUser();
  if (!user) {
    redirect('/sign-in');
  }

  const orgs = await getOrgsForUser(user.id);
  if (orgs.length === 0) {
    return <EmptyOrgState />;
  }

  redirect(`/dashboard/org/${orgs[0].organization.slug}`);
}
