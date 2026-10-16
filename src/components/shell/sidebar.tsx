'use client';

import { Activity, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brand } from '@/components/brand';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, isActive } from './nav-items';

export function Sidebar({ syncLabel, syncDetail }: { syncLabel: string; syncDetail: string }) {
  const pathname = usePathname();
  const link = (href: string, active: boolean) =>
    cn(
      'flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-semibold no-underline',
      active ? 'bg-primary-soft text-primary-on-soft' : 'text-ink-2 hover:bg-surface-2',
    );
  return (
    <nav
      aria-label="Menu principal"
      className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-4 py-6 lg:flex"
    >
      <Link href="/" className="px-2 text-ink no-underline">
        <Brand />
      </Link>
      <div className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className={link(i.href, isActive(pathname, i.href))}
            aria-current={isActive(pathname, i.href) ? 'page' : undefined}
          >
            <i.icon className="size-[18px]" aria-hidden="true" />
            {i.label}
          </Link>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-1">
        <Link href="/status" className={link('/status', isActive(pathname, '/status'))}>
          <Activity className="size-[18px]" aria-hidden="true" />
          Status da sincronização
        </Link>
        <Link
          href="/configuracoes"
          className={link('/configuracoes', isActive(pathname, '/configuracoes'))}
        >
          <Settings className="size-[18px]" aria-hidden="true" />
          Configurações
        </Link>
        <div className="mt-2 flex flex-col gap-1.5 rounded-xl bg-surface-2 p-3 text-[13px]">
          <span className="flex items-center gap-2 font-bold text-primary-on-soft">
            <span className="size-2 rounded-full bg-current" />
            {syncLabel}
          </span>
          <span className="text-ink-2">{syncDetail}</span>
        </div>
      </div>
    </nav>
  );
}
