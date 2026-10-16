import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Pill } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { formatBR, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { cn } from '@/lib/cn';
import { getCategories } from '@/server/queries/categories';
import { getPlannedView } from '@/server/queries/income';
import { PlannedForm, PlannedStatusButtons } from './planned-client';

export const metadata = { title: 'Gastos planejados' };

const METHOD = { pix: 'Pix', debit: 'Débito', credit: 'Crédito' } as const;

export default async function PlannedPage() {
  const [v, categories] = await Promise.all([getPlannedView(), getCategories()]);
  const open = v.items.filter((i) => i.status === 'planned');
  const closed = v.items.filter((i) => i.status !== 'planned');
  return (
    <>
      <PageHeader title="Gastos planejados" kicker={`${open.length} em aberto`} />
      <p className="-mt-2 text-sm text-ink-2">
        Compras e contas que você já sabe que vêm (IPVA, viagem, presente). No crédito, cada parcela
        entra na fatura certa e sai do caixa no vencimento.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col py-1 lg:col-span-2">
          {open.length === 0 ? (
            <p className="py-4 text-sm text-ink-2">Nada planejado.</p>
          ) : (
            open.map((i) => (
              <div
                key={i.id}
                className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0 sm:flex-row sm:items-center"
                data-testid="planned-row"
              >
                <div className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 font-bold">
                    {i.description}
                    <Pill className="bg-surface-2 text-ink-2">
                      {METHOD[i.paymentMethod]}
                      {i.installments > 1 ? ` ${i.installments}×` : ''}
                    </Pill>
                  </span>
                  <span className="text-xs text-ink-2">
                    {formatBR(i.date as LocalDate)}
                    {i.accountName ? ` · ${i.accountName}` : ''}
                    {i.categoryLabel ? ` · ${i.categoryLabel}` : ''}
                    {i.cash.length
                      ? ` · sai do caixa em ${i.cash.map((c) => formatBR(c.cashDate as LocalDate).slice(0, 5)).join(', ')}`
                      : ''}
                  </span>
                </div>
                <Money cents={-i.amountCents} signed className="font-extrabold" />
                <PlannedStatusButtons id={i.id} name={i.description} />
              </div>
            ))
          )}
        </Card>
        <Card className="flex flex-col gap-3 self-start">
          <CardTitle>Planejar gasto</CardTitle>
          <PlannedForm accounts={v.accounts} categories={categories} today={todaySP()} />
        </Card>
      </div>
      {closed.length ? (
        <details className="rounded-[18px] border border-border bg-surface p-4">
          <summary className="cursor-pointer text-sm font-bold">
            Concluídos e cancelados ({closed.length})
          </summary>
          <ul className="mt-2 text-sm">
            {closed.map((i) => (
              <li
                key={i.id}
                className={cn('py-1', i.status === 'cancelled' && 'text-ink-3 line-through')}
              >
                {formatBR(i.date as LocalDate)} · {i.description} · <Money cents={i.amountCents} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
