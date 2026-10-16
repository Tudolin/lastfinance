import type { ReactNode } from 'react';
import { HeaderActions } from './header-actions';

export function PageHeader({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker?: string;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <div className="mr-auto flex flex-col gap-0.5">
        {kicker ? <span className="text-[13px] font-semibold text-ink-2">{kicker}</span> : null}
        <h1 className="text-2xl font-extrabold tracking-tight lg:text-[28px]">{title}</h1>
      </div>
      {children}
      <div className="lg:hidden">
        <HeaderActions compact />
      </div>
      <div className="hidden lg:block">
        <HeaderActions />
      </div>
    </header>
  );
}
