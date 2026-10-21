'use client';

import { ConsoleNavbar } from '@/components/console/console-navbar';
import {
  type ConsoleScope,
  ConsoleScopeProvider,
} from '@/components/console/console-scope';
import { ConsoleSidebar } from '@/components/console/console-sidebar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';

/**
 * Two-row frame: a full-width navbar on top, then the sidebar and the
 * independently scrolling content region.
 */
export function ConsoleFrame({
  scope,
  children,
}: {
  scope: ConsoleScope | null;
  children: React.ReactNode;
}) {
  return (
    <ConsoleScopeProvider scope={scope}>
      <SidebarProvider className="grid h-dvh min-h-0 grid-rows-[auto_minmax(0,1fr)] print:block print:h-auto">
        <div className="contents print:hidden">
          <ConsoleNavbar />
        </div>
        <div className="flex min-h-0 min-w-0">
          <div className="contents print:hidden">
            <ConsoleSidebar />
          </div>
          <SidebarInset className="min-h-0 overflow-hidden bg-shell print:overflow-visible print:bg-white">
            <div className="min-w-0 flex-1 overflow-y-auto print:overflow-visible">
              {children}
            </div>
          </SidebarInset>
        </div>
      </SidebarProvider>
    </ConsoleScopeProvider>
  );
}
