import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { Pill } from '@/components/ui/badge';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { SOURCE_LABEL } from '@/domain/forecast/types';
import { cn } from '@/lib/cn';
import { getReconciliation } from '@/server/queries/forecast';
import { EntryActions } from './reconcile-client';

export const metadata = { title: 'Conciliação' };

const STATUS_STYLE = {
  previsto: 'bg-surface-2 text-ink-2',
  realizado: 'bg-primary-soft text-primary-on-soft',
  atrasado: 'bg-warn-soft text-warn-ink',
  cancelado: 'bg-surface-2 text-ink-3 line-through',
  ajustado: 'bg-info-soft text-info-ink',
} as const;

export default async function ReconciliationPage() {
  const rows = await getReconciliation();
  const late = rows.filter((r) => r.e.status === 'atrasado');
  return (
    <>
      <PageHeader title="Conciliação" kicker="Previsto × realizado (últimos 45 dias)">
        <Link href="/previsao" className="text-sm font-bold">
          Voltar à previsão
        </Link>
      </PageHeader>
      <p className="-mt-2 text-sm text-ink-2">
        Cada previsto procura a transação real dentro de uma janela de dias úteis, com tolerância de
        valor e semelhança com o empregador ou estabelecimento. Uma transação nunca conta para dois
        previstos. Se um par estiver errado, desfaça: ele não volta a ser sugerido.
      </p>
      {late.length ? (
        <p className="rounded-xl border border-warn-border bg-warn-soft p-3 text-sm font-semibold text-warn-ink">
          {late.length} {late.length === 1 ? 'previsto atrasado' : 'previstos atrasados'}: não
          chegou nada parecido até o fim da janela. Case à mão, ajuste o valor ou cancele.
        </p>
      ) : null}
      <Card className="flex flex-col py-1">
        {rows.length === 0 ? (
          <p className="py-4 text-sm text-ink-2">Ainda não há previstos no período.</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.e.id}
              className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0 sm:flex-row sm:items-center"
              data-testid="reconcile-row"
            >
              <div className="flex flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-bold">
                  {r.e.label}
                  <Pill className={cn(STATUS_STYLE[r.e.status])}>{r.e.status}</Pill>
                  <span className="text-xs font-semibold text-ink-2">
                    {SOURCE_LABEL[r.e.sourceType]}
                  </span>
                </span>
                <span className="text-xs text-ink-2">
                  Previsto para {formatBR(r.e.expectedDate as LocalDate)}:{' '}
                  <Money
                    cents={r.e.userOverrideCents ?? r.e.expectedCents}
                    className="font-bold text-ink"
                  />
                  {r.e.userOverrideCents != null ? ' (ajustado)' : ''}
                </span>
                {r.txId ? (
                  <span className="text-xs text-ink-2">
                    Casado com <strong className="text-ink">{r.txDescription}</strong> em{' '}
                    {formatBR(r.txDate as LocalDate)}: <Money cents={r.actualCents!} />{' '}
                    {r.deltaCents ? (
                      <>
                        (Δ <Money cents={r.deltaCents} signed />)
                      </>
                    ) : null}
                    {r.matchedBy === 'user' ? ' · por você' : ''}
                  </span>
                ) : null}
              </div>
              <EntryActions
                entryId={r.e.id}
                matchId={r.matchId}
                status={r.e.status}
                expectedCents={r.e.userOverrideCents ?? r.e.expectedCents}
              />
            </div>
          ))
        )}
      </Card>
    </>
  );
}
