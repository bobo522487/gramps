import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { SWRConfig } from 'swr';
import { ThemeProvider } from '@/components/theme-provider';
import { getSessionUser } from '@/lib/auth/context';
import { getOrgsForUser } from '@/lib/db/queries/organizations';

export const metadata: Metadata = {
  title: '云谱',
  description: '整理谱系、谱文与谱书的家族协作工作台。',
};

export const viewport: Viewport = {
  themeColor: '#3ecf8e',
};

const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope' });

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  const sessionUser = user
    ? { id: user.id, name: user.name, email: user.email }
    : null;
  const orgs = user ? await getOrgsForUser(user.id) : [];
  const orgFallback = orgs.map(({ organization, role }) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    role,
  }));

  return (
    <html lang="zh-CN" suppressHydrationWarning className={manrope.variable}>
      <body className="min-h-[100dvh] bg-shell text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SWRConfig
            value={{
              fallback: {
                '/api/user': sessionUser,
                '/api/orgs': orgFallback,
              },
            }}
          >
            {children}
          </SWRConfig>
        </ThemeProvider>
      </body>
    </html>
  );
}
