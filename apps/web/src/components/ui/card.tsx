import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils.ts';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn('flex flex-col gap-4 rounded-lg border bg-background p-5 shadow-xs', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}
