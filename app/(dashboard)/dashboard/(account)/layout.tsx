import { redirect } from 'next/navigation';
import { ConsoleFrame } from '@/components/console/console-frame';
import { getUser } from '@/lib/db/queries';

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) {
    redirect('/sign-in');
  }

  return <ConsoleFrame scope={null}>{children}</ConsoleFrame>;
}
