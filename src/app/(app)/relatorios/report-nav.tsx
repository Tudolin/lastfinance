import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/** Abas Mês/Ano, setas de período e o botão de exportar CSV. */
export function ReportNav({
  tab,
  label,
  prevHref,
  nextHref,
  exportHref,
}: {
  tab: 'mes' | 'ano';
  label: string;
  prevHref: string;
  nextHref: string | null;
  exportHref: string;
}) {
  const tabCls = (on: boolean) =>
    cn(
      'rounded-full px-3.5 py-2 text-[13px] font-bold no-underline',
      on ? 'bg-ink text-bg' : 'text-ink-2 hover:bg-surface-2',
    );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <nav aria-label="Tipo de relatório" className="flex rounded-full border border-border p-1">
        <Link
          href="/relatorios"
          className={tabCls(tab === 'mes')}
          aria-current={tab === 'mes' ? 'page' : undefined}
        >
          Mês
        </Link>
        <Link
          href="/relatorios/anual"
          className={tabCls(tab === 'ano')}
          aria-current={tab === 'ano' ? 'page' : undefined}
        >
          Ano
        </Link>
      </nav>
      <div className="flex items-center gap-1">
        <Link
          href={prevHref}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          aria-label="Período anterior"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>
        <span className="min-w-36 text-center font-bold">{label}</span>
        {nextHref ? (
          <Link
            href={nextHref}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Próximo período"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
      </div>
      <a href={exportHref} className={buttonVariants({ variant: 'outline', size: 'sm' })} download>
        <Download className="size-4" aria-hidden="true" />
        Exportar CSV
      </a>
    </div>
  );
}
