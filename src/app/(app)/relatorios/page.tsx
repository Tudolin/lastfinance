import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import {
  addMonths,
  endOfMonth,
  formatBR,
  localDate,
  startOfMonth,
  todaySP,
  type LocalDate,
} from '@/domain/dates/local-date';
import { monthTitle } from '@/lib/format';
import { cn } from '@/lib/cn';
import { getMonthlyReport } from '@/server/queries/reports';
import { ReportNav } from './report-nav';

export const metadata = { title: 'Relatório do mês' };

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Delta({ cents, inverse = false }: { cents: number; inverse?: boolean }) {
  if (cents === 0) return <span className="text-xs text-ink-2">igual</span>;
  const good = inverse ? cents < 0 : cents > 0;
  const Icon = cents > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-bold',
        good ? 'text-primary-on-soft' : 'text-danger',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      <Money cents={Math.abs(cents)} />
    </span>
  );
}

function Stat({
  label,
  cents,
  prevCents,
  inverse,
  testId,
}: {
  label: string;
  cents: number;
  prevCents: number;
  inverse?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-surface-2 p-3" data-testid={testId}>
      <span className="text-xs font-bold text-ink-2">{label}</span>
      <Money cents={cents} className="text-xl font-extrabold" />
      <span className="flex items-center gap-1 text-xs text-ink-2">
        vs. mês anterior <Delta cents={cents - prevCents} inverse={inverse} />
      </span>
    </div>
  );
}

export default async function MonthlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const today = todaySP();
  const month = m && /^\d{4}-\d{2}$/.test(m) ? localDate(`${m}-01`) : startOfMonth(today);
  const safe = month > today ? startOfMonth(today) : month;
  const r = await getMonthlyReport(safe);
  const ym = (d: LocalDate) => d.slice(0, 7);
  const next = addMonths(safe, 1);
  const max = Math.max(1, ...r.categories.map((c) => c.cents));

  return (
    <>
      <PageHeader title="Relatórios" kicker={r.partial ? 'Mês em andamento' : 'Mês fechado'}>
        <ReportNav
          tab="mes"
          label={monthTitle(safe)}
          prevHref={`/relatorios?m=${ym(addMonths(safe, -1))}`}
          nextHref={next <= today ? `/relatorios?m=${ym(next)}` : null}
          exportHref={`/api/exportar/transacoes?from=${safe}&to=${endOfMonth(safe)}`}
        />
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Receitas" cents={r.summary.incomeCents} prevCents={r.previous.incomeCents} />
        <Stat
          label="Gastos"
          cents={r.summary.expenseCents}
          prevCents={r.previous.expenseCents}
          inverse
          testId="report-expense"
        />
        <Stat label="Sobrou" cents={r.summary.leftoverCents} prevCents={r.previous.leftoverCents} />
        <Stat
          label="Aplicado"
          cents={r.summary.investedCents}
          prevCents={r.previous.investedCents}
        />
      </div>

      {r.savingsRate != null ? (
        <Notice tone={r.savingsRate >= r.savingsGoal ? 'success' : 'warn'}>
          Você guardou <strong>{pct(r.savingsRate)}</strong> da renda
          {r.partial ? ' até agora' : ''} (meta de {pct(r.savingsGoal)}).
          {r.netWorth ? (
            <>
              {' '}
              Seu patrimônio {r.netWorth.deltaCents >= 0 ? 'cresceu' : 'caiu'}{' '}
              <Money cents={Math.abs(r.netWorth.deltaCents)} className="font-bold" /> entre{' '}
              {formatBR(r.netWorth.from as LocalDate)} e {formatBR(r.netWorth.to as LocalDate)}.
            </>
          ) : null}
        </Notice>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col gap-2 lg:col-span-2" aria-label="Gastos por categoria">
          <CardTitle>Gastos por categoria</CardTitle>
          {r.categories.length === 0 ? (
            <p className="text-sm text-ink-2">Nenhum gasto neste mês.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {r.categories.slice(0, 12).map((c) => (
                <li key={c.label} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-bold">{c.label}</span>
                    <span className="flex items-baseline gap-2">
                      <Delta cents={c.deltaCents} inverse />
                      <Money cents={c.cents} className="font-bold" />
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-track" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-[#2e9a78]"
                      style={{ width: `${Math.round((Math.max(0, c.cents) / max) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-2" aria-label="Maiores gastos">
            <CardTitle>Maiores gastos</CardTitle>
            {r.biggest.length === 0 ? (
              <p className="text-sm text-ink-2">Nenhum.</p>
            ) : (
              <ul className="flex flex-col">
                {r.biggest.map((b) => (
                  <li key={b.id} className="border-t border-surface-2 py-2 first:border-t-0">
                    <Link
                      href={`/transacoes/${b.id}`}
                      className="flex items-baseline justify-between gap-2 text-sm text-ink no-underline"
                    >
                      <span className="font-bold">{b.description}</span>
                      <Money cents={b.amountCents} className="font-bold" />
                    </Link>
                    <span className="text-xs text-ink-2">
                      {formatBR(b.date as LocalDate)} · {b.accountName}
                      {b.category ? ` · ${b.category}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {r.budgets.total ? (
            <Card className="flex flex-col gap-1">
              <CardTitle>Orçamentos</CardTitle>
              <p className="text-sm text-ink-2">
                {r.budgets.over.length === 0
                  ? `Todos os ${r.budgets.total} dentro do limite.`
                  : `${r.budgets.over.length} de ${r.budgets.total} estouraram: ${r.budgets.over.join(', ')}.`}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-ink-2">
        Por competência: compras no cartão contam no dia da compra. A exportação traz todas as
        transações do mês.
      </p>
    </>
  );
}
