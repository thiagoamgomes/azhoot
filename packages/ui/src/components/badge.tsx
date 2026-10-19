import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '../cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-primary/10 text-primary-strong dark:text-blue-300',
        success: 'bg-success/10 text-success-strong dark:bg-success/20 dark:text-green-300',
        warning: 'bg-warning/15 text-warning-strong dark:text-amber-300',
        danger: 'bg-danger/10 text-red-700 dark:text-red-300',
        muted: 'bg-muted text-muted-foreground',
        accent: 'bg-accent/10 text-violet-700 dark:text-violet-300',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
