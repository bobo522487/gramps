import type { Badge } from '@/components/ui/badge';

type BadgeVariant = NonNullable<React.ComponentProps<typeof Badge>['variant']>;

/**
 * Single mapping from the raw database status/health/role strings to the
 * badge treatment, so pages never branch on status themselves.
 */
const VARIANTS: Record<string, BadgeVariant> = {
  ACTIVE: 'success',
  HEALTHY: 'success',
  owner: 'success',
  PAUSED: 'warning',
  DEGRADED: 'warning',
  member: 'info',
  ARCHIVED: 'secondary',
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '活跃',
  PAUSED: '已暂停',
  ARCHIVED: '已归档',
  HEALTHY: '健康',
  DEGRADED: '降级',
};

const ROLE_LABELS: Record<string, string> = {
  owner: '所有者',
  member: '成员',
};

const REGION_LABELS: Record<string, string> = {
  'us-east-1': '美国东部',
  'us-west-2': '美国西部',
  'eu-west-1': '欧洲西部',
  'eu-central-1': '欧洲中部',
  'ap-northeast-1': '日本东京',
  'ap-southeast-1': '新加坡',
  'sa-east-1': '巴西圣保罗',
};

export function statusVariant(value: string): BadgeVariant {
  return VARIANTS[value] ?? 'outline';
}

export function statusLabel(value: string): string {
  return STATUS_LABELS[value] ?? value;
}

export function roleLabel(value: string): string {
  return ROLE_LABELS[value] ?? value;
}

export function regionLabel(value: string): string {
  return REGION_LABELS[value] ?? value;
}
