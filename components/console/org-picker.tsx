'use client';

import { Boxes, Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  type ConsoleOrg,
  useConsoleOrgs,
  useConsoleScope,
} from '@/components/console/console-scope';
import { CreateOrgDialog } from '@/components/org/create-org-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function OrgPicker() {
  const scope = useConsoleScope();
  const { data: orgs } = useConsoleOrgs();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [query, setQuery] = useState('');

  const active =
    orgs?.find((org) => org.id === scope?.org.id) ?? scope?.org ?? null;
  const filtered = useMemo(() => {
    const list: ConsoleOrg[] = orgs ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return list;
    }
    return list.filter((org) => org.name.toLowerCase().includes(needle));
  }, [orgs, query]);

  return (
    <>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(next) => {
          setMenuOpen(next);
          if (!next) {
            setQuery('');
          }
        }}
      >
        <div className="flex min-w-0 items-center">
          <Link
            href={active ? `/dashboard/org/${active.slug}` : '/dashboard'}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Boxes className="size-4 shrink-0 text-muted-foreground" />
            <span className="max-w-[110px] truncate sm:max-w-[180px]">
              {active?.name ?? '组织'}
            </span>
          </Link>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              aria-label="切换组织"
            >
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="start" size="sm" className="w-60">
          <DropdownMenuSearch
            value={query}
            onValueChange={setQuery}
            onEnter={() => {
              const target = filtered[0];
              if (target) {
                setMenuOpen(false);
                router.push(`/dashboard/org/${target.slug}`);
              }
            }}
            placeholder="搜索组织"
          />
          <DropdownMenuGroup>
            {filtered.map((org) => (
              <DropdownMenuItem key={org.id} asChild>
                <Link
                  href={`/dashboard/org/${org.slug}`}
                  className="flex w-full items-center gap-2"
                >
                  <span className="flex-1 truncate">{org.name}</span>
                  {org.id === active?.id ? (
                    <Check className="size-3.5 text-primary" />
                  ) : null}
                </Link>
              </DropdownMenuItem>
            ))}
            {filtered.length === 0 ? (
              <DropdownMenuLabel className="text-muted-foreground font-normal">
                没有匹配的组织
              </DropdownMenuLabel>
            ) : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setMenuOpen(false);
              setIsCreateOpen(true);
            }}
          >
            <Plus />
            新建组织
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateOrgDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} />
    </>
  );
}
