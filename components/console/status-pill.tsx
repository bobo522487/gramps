import { Badge } from '@/components/ui/badge';
import { statusLabel, statusVariant } from '@/lib/ui/status';
import { cn } from '@/lib/utils';

export function StatusPill({
  value,
  pulse = false,
  className,
}: {
  value: string;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <Badge variant={statusVariant(value)} className={cn('gap-1.5', className)}>
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full bg-current',
          pulse && 'animate-pulse'
        )}
      />
      {statusLabel(value)}
    </Badge>
  );
}
