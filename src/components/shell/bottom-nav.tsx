'use client';

import { Ellipsis } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { NAV_ITEMS, isActive } from './nav-items';

export function BottomNav() {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((i) => i.mobile);
  const moreActive = !items.some((i) => isActive(pathname, i.href));
  const cls = (active: boolean) =>
    cn(
      'flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] font-bold no-underline',
      active ? 'text-primary-on-soft' : 'text-ink-2',
    );
  return (
    <nav
      aria-label="Navegação"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-surface px-2 pt-2 pb-[max(18px,env(safe-area-inset-bottom))] lg:hidden"
    >
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          className={cls(isActive(pathname, i.href))}
          aria-current={isActive(pathname, i.href) ? 'page' : undefined}
        >
          <i.icon className="size-[22px]" aria-hidden="true" />
          {i.label}
        </Link>
      ))}
      <Link href="/mais" className={cls(moreActive)}>
        <Ellipsis className="size-[22px]" aria-hidden="true" />
        Mais
      </Link>
    </nav>
  );
}
