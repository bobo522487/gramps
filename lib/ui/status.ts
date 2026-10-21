import type { Badge } from '@/components/ui/badge';

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>;

/** Role → badge treatment and label, shared by every member surface. */
const ROLE_VARIANTS: Record<string, BadgeVariant> = {
  owner: 'success',
  admin: 'info',
  editor: 'info',
  viewer: 'secondary',
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  admin: '管理员',
  editor: '编辑',
  viewer: '只读',
};

export function roleVariant(value: string): BadgeVariant {
  return ROLE_VARIANTS[value] ?? 'outline';
}

export function roleLabel(value: string): string {
  return ROLE_LABELS[value] ?? value;
}
