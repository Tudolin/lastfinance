import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <Brand />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="text-sm text-ink-2">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}
