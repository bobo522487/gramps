import { ConsoleFrame } from '@/components/console/console-frame';

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ConsoleFrame scope={null}>{children}</ConsoleFrame>;
}
