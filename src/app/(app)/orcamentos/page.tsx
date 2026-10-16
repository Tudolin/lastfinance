import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import {
  addMonths,
  isLocalDate,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import { monthTitle } from '@/lib/format';
import { getCategories } from '@/server/queries/categories';
import { getBudgets } from '@/server/queries/planning';
import { BudgetForm, CopyBudgetsButton, DeleteBudgetButton } from './budgets-client';

export const metadata = { title: 'Orçamentos' };

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const raw = (await searchParams).mes;
  const month = startOfMonth(
    raw && isLocalDate(`${raw}-01`) ? (`${raw}-01` as LocalDate) : todaySP(),
  );
  const [budgets, categories] = await Promise.all([getBudgets(month), getCategories()]);
  const isCurrent = month === startOfMonth(todaySP());
  const nav = (m: LocalDate) => `/orcamentos?mes=${m.slice(0, 7)}`;
  const totalLimit = budgets.reduce((s, b) => s + b.pace.limitCents, 0);
  const totalSpent = budgets.reduce((s, b) => s + b.pace.spentCents, 0);
  return (
    <>
      <PageHeader title="Orçamentos" kicker={monthTitle(month)}>
        <div className="flex items-center gap-1">
          <Link
            href={nav(addMonths(month, -1))}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Mês anterior"
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
          <Link
            href={nav(addMonths(month, 1))}
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
            aria-label="Próximo mês"
          >
            <ChevronRight className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </PageHeader>
      <p className="-mt-2 text-sm text-ink-2">
        Gasto pela data da compra (competência), incluindo subcategorias. Alertas aos 80% e 100%
        chegam por notificação na Fase 5.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="flex flex-col gap-3 lg:col-span-2">
          {budgets.length ? (
            <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4">
              <span className="text-sm text-ink-2">
                Total: <Money cents={totalSpent} className="font-extrabold text-ink" /> de{' '}
                <Money cents={totalLimit} />
              </span>
              <CopyBudgetsButton month={month} />
            </Card>
          ) : (
            <Card className="flex flex-col items-start gap-3">
              <p className="text-ink-2">Nenhum orçamento para este mês.</p>
              <CopyBudgetsButton month={month} />
            </Card>
          )}
          {budgets.map((b) => {
            const pct = Math.min(100, Math.round(b.pace.usedRatio * 100));
            const tone =
              b.pace.status === 'exceeded'
                ? 'bg-danger'
                : b.pace.status === 'warning'
                  ? 'bg-warn'
                  : 'bg-[#0b6e55]';
            return (
              <Card key={b.id} className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ background: b.color ?? '#94a3b8' }}
                    aria-hidden="true"
                  />
                  <Link
                    href={`/transacoes?category=${b.categoryId}&basis=accrual&from=${month}`}
                    className="flex-1 font-bold text-ink no-underline"
                  >
                    {b.label}
                  </Link>
                  <span className="text-sm">
                    <Money cents={b.pace.spentCents} className="font-extrabold" />{' '}
                    <span className="text-ink-2">de</span>{' '}
                    <Money cents={b.pace.limitCents} className="text-ink-2" />
                  </span>
                  <DeleteBudgetButton id={b.id} label={b.label} />
                </div>
                <div
                  className="h-2.5 rounded bg-track"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${b.label}: ${pct}% usado`}
                >
                  <div className={`h-2.5 rounded ${tone}`} style={{ width: `${pct}%` }} />
                </div>
                <span
                  className={`text-xs ${b.pace.status === 'ok' ? 'text-ink-2' : 'font-bold text-warn-ink dark:text-warn'}`}
                >
                  {b.pace.status === 'exceeded' ? (
                    <>
                      Estourou em <Money cents={-b.pace.remainingCents} />.
                    </>
                  ) : isCurrent ? (
                    <>
                      No ritmo atual, você vai gastar <Money cents={b.pace.projectedCents} /> até o
                      fim do mês
                      {b.pace.projectedCents > b.pace.limitCents ? ' — acima do limite.' : '.'}
                    </>
                  ) : (
                    <>
                      Sobrou <Money cents={b.pace.remainingCents} />.
                    </>
                  )}
                  {b.rollover ? ' · leva a sobra' : ''}
                  {b.pace.limitCents !== b.amountCents ? (
                    <>
                      {' '}
                      · inclui <Money cents={b.pace.limitCents - b.amountCents} /> do mês anterior
                    </>
                  ) : null}
                </span>
              </Card>
            );
          })}
        </div>
        <Card className="flex flex-col gap-3 self-start">
          <CardTitle>Definir orçamento</CardTitle>
          <BudgetForm month={month} categories={categories} />
        </Card>
      </div>
    </>
  );
}
