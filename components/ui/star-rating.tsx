'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const STARS = [1, 2, 3, 4, 5] as const;

export function StarRating({
  value,
  onChange,
  label = '重要等级',
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset
      aria-label={label}
      className="flex items-center gap-1 border-0 p-0"
    >
      {STARS.map((star) => {
        const selected = star <= value;
        return (
          <button
            key={star}
            type="button"
            aria-label={`${star} 星`}
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(star)}
            className="rounded-sm p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Star
              className={cn(
                'size-5',
                selected
                  ? 'fill-amber-500 text-amber-500'
                  : 'text-muted-foreground'
              )}
            />
          </button>
        );
      })}
      <span className="ml-2 text-xs text-muted-foreground">{value} 星</span>
    </fieldset>
  );
}
