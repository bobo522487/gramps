import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { getSessionUser } from '@/lib/auth/context';
import { Login } from '../login';

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  if (invite && (await getSessionUser())) {
    redirect(`/dashboard/join?token=${encodeURIComponent(invite)}`);
  }

  return (
    <Suspense>
      <Login mode="signup" />
    </Suspense>
  );
}
