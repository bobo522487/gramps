'use client';

import { Tabs as TabsPrimitive } from 'radix-ui';
import type * as React from 'react';

import { cn } from '@/lib/utils';

type TabsVariant = 'pill' | 'underline';

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  size = 'default',
  variant = 'pill',
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & {
  size?: 'default' | 'sm';
  variant?: TabsVariant;
}) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-size={size}
      data-variant={variant}
      className={cn(
        'group/tabs-list text-muted-foreground inline-flex w-fit items-center',
        variant === 'underline'
          ? 'gap-1 border-b'
          : cn(
              'justify-center rounded-lg bg-muted p-[3px]',
              size === 'sm' ? 'h-7' : 'h-9'
            ),
        className
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'text-muted-foreground data-[state=active]:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
        // Framed tab inside a rounded track. Everything that draws the pill is
        // gated on the list variant so an underline tab never inherits its border.
        'group-data-[variant=pill]/tabs-list:rounded-md group-data-[variant=pill]/tabs-list:border group-data-[variant=pill]/tabs-list:border-transparent group-data-[variant=pill]/tabs-list:px-2.5 group-data-[variant=pill]/tabs-list:py-1 group-data-[variant=pill]/tabs-list:text-sm group-data-[variant=pill]/tabs-list:data-[state=active]:bg-background group-data-[variant=pill]/tabs-list:data-[state=active]:shadow-sm',
        'group-data-[size=sm]/tabs-list:group-data-[variant=pill]/tabs-list:h-[calc(100%-1px)] group-data-[size=sm]/tabs-list:group-data-[variant=pill]/tabs-list:px-2 group-data-[size=sm]/tabs-list:group-data-[variant=pill]/tabs-list:text-xs',
        // Tab sitting on the list rule: the bottom border is the selection mark.
        'group-data-[variant=underline]/tabs-list:rounded-none group-data-[variant=underline]/tabs-list:border-0 group-data-[variant=underline]/tabs-list:border-b-2 group-data-[variant=underline]/tabs-list:border-b-transparent group-data-[variant=underline]/tabs-list:px-3 group-data-[variant=underline]/tabs-list:py-2 group-data-[variant=underline]/tabs-list:text-xs group-data-[variant=underline]/tabs-list:data-[state=active]:border-b-primary group-data-[variant=underline]/tabs-list:data-[state=active]:shadow-none',
        className
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
