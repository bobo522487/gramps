import { ConsoleFrame } from '@/components/console/console-frame';
import { requireUser } from '@/lib/auth/context';

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return <ConsoleFrame scope={null}>{children}</ConsoleFrame>;
}
