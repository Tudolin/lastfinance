import { Activity, ChevronRight, Settings } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Mais' };

export default function MorePage() {
  const items = [
    ...NAV_ITEMS.filter((i) => !i.mobile),
    { href: '/status', label: 'Status da sincronização', icon: Activity },
    { href: '/configuracoes', label: 'Configurações', icon: Settings },
  ];
  return (
    <>
      <PageHeader title="Mais" />
      <Card className="py-1">
        {items.map((i) => (
          <Link
            key={i.href}
            href={i.href}
            className="flex min-h-12 items-center gap-3 border-t border-surface-2 py-3 text-ink no-underline first:border-t-0"
          >
            <i.icon className="size-5 text-ink-2" aria-hidden="true" />
            <span className="flex-1 font-bold">{i.label}</span>
            <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
          </Link>
        ))}
      </Card>
    </>
  );
}
