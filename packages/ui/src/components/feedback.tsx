import { AlertTriangle, Inbox, Loader2 } from 'lucide-react';
import * as React from 'react';
import { cn } from '../cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-xl bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}

export function Spinner({
  label = 'Carregando…',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex items-center justify-center gap-2 p-6 text-muted-foreground', className)}
    >
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

interface StateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, description, action, icon, className }: StateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-6 py-12 text-center',
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        {icon ?? <Inbox className="size-6" />}
      </div>
      <div className="grid gap-1">
        <p className="font-display text-base font-semibold">{title}</p>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Algo deu errado',
  description,
  action,
  className,
}: Partial<StateProps>) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="grid size-12 place-items-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle className="size-6" />
      </div>
      <div className="grid gap-1">
        <p className="font-display text-base font-semibold">{title}</p>
        {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Alert({
  variant = 'info',
  className,
  children,
}: {
  variant?: 'info' | 'danger' | 'warning' | 'success';
  className?: string;
  children: React.ReactNode;
}) {
  const styles = {
    info: 'border-primary/30 bg-primary/5 text-foreground',
    danger: 'border-danger/40 bg-danger/5 text-foreground',
    warning: 'border-warning/50 bg-warning/10 text-foreground',
    success: 'border-success/40 bg-success/5 text-foreground',
  }[variant];
  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm', styles, className)}
    >
      {children}
    </div>
  );
}
