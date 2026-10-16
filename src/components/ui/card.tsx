import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn('rounded-[18px] border border-border bg-surface p-5', className)}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('text-[17px] font-extrabold', className)} {...props} />;
}

export function Notice({
  tone = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: 'info' | 'warn' | 'danger' | 'success' }) {
  const tones = {
    info: 'bg-surface-2 text-ink-2',
    warn: 'bg-warn-soft text-warn-ink border border-warn-border',
    danger: 'bg-danger-soft text-danger-ink',
    success: 'bg-primary-soft text-primary-on-soft',
  };
  return (
    <div
      role="status"
      className={cn('rounded-xl p-3 text-sm', tones[tone], className)}
      {...props}
    />
  );
}
