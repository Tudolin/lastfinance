import { CircleAlert, Landmark, LineChart, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { BasisToggle } from '@/components/tx/basis-toggle';
import { TransactionRow } from '@/components/tx/transaction-row';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { addMonths, clampedDate, parts, startOfMonth, todaySP } from '@/domain/dates/local-date';
import { monthTitle, shortDate, weekdayDate } from '@/lib/format';
import { getBalances, getConnections, getOpenBills } from '@/server/queries/accounts';
import { requireUnlocked } from '@/server/auth/request';
import { categoryBreakdown, countPendingReview, getCategories } from '@/server/queries/categories';
import { getForecastView } from '@/server/queries/forecast';
import { getBudgets } from '@/server/queries/planning';
import { listTransactions, summarize } from '@/server/queries/transactions';

export const metadata = { title: 'Painel' };

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ basis?: string }>;
}) {
  const basis = (await searchParams).basis === 'accrual' ? 'accrual' : 'cash';
  const today = todaySP();
  const connections = await getConnections();

  if (connections.length === 0) {
    return (
      <>
        <PageHeader title={monthTitle(today)} kicker={weekdayDate(today)} />
        <Card className="flex flex-col items-start gap-4 p-8">
          <Landmark className="size-8 text-primary-on-soft" aria-hidden="true" />
          <CardTitle className="text-xl">Conecte suas contas para começar</CardTitle>
          <p className="max-w-prose text-ink-2">
            O lastfinance lê seus dados via Open Finance (Pluggy), em modo somente leitura. Depois
            da conexão, o histórico dos últimos 12 meses é importado automaticamente.
          </p>
          <Link href="/contas" className={buttonVariants({ size: 'lg' })}>
            Conectar instituição
          </Link>
        </Card>
      </>
    );
  }

  const { day } = parts(today);
  const monthStart = startOfMonth(today);
  const prevStart = addMonths(monthStart, -1);
  const prevSameDay = clampedDate(parts(prevStart).year, parts(prevStart).month, day);

  const [
    balances,
    bills,
    current,
    previous,
    recent,
    session,
    breakdown,
    categories,
    reviewCount,
    budgets,
    forecast,
  ] = await Promise.all([
    getBalances(),
    getOpenBills(today),
    summarize(monthStart, today, basis),
    summarize(prevStart, prevSameDay, basis),
    listTransactions({ basis: 'cash', page: 1 }),
    requireUnlocked(),
    categoryBreakdown(monthStart, today, basis),
    getCategories(),
    countPendingReview(),
    getBudgets(today),
    getForecastView(30),
  ]);
  const forecastVerdict =
    forecast.base.min.balance < 0
      ? 'no'
      : forecast.base.min.balance < forecast.reserveCents
        ? 'warn'
        : 'ok';
  const goal = session.settings.savingsGoalPct;
  // agrega por categoria-mãe para o resumo
  const byRoot = new Map<string | null, number>();
  for (const b of breakdown) {
    const c = categories.find((x) => x.id === b.categoryId);
    const root = c?.parentId ?? c?.id ?? null;
    byRoot.set(root, (byRoot.get(root) ?? 0) + b.cents);
  }
  const topCategories = [...byRoot.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  const maxCat = Math.max(1, ...topCategories.map(([, v]) => v));
  const budgetAlerts = budgets.filter((b) => b.pace.status !== 'ok');
  const surplus = current.incomeCents - current.expenseCents;
  const savingsRate =
    current.incomeCents > 0 ? Math.round((surplus / current.incomeCents) * 100) : null;
  const spendDelta =
    previous.expenseCents > 0
      ? Math.round(((current.expenseCents - previous.expenseCents) / previous.expenseCents) * 100)
      : null;
  const prevMonthName = new Date(
    Date.UTC(parts(prevStart).year, parts(prevStart).month - 1, 15),
  ).toLocaleString('pt-BR', { month: 'long', timeZone: 'UTC' });

  return (
    <>
      <PageHeader title={monthTitle(today)} kicker={weekdayDate(today)}>
        <BasisToggle basis={basis} hrefFor={(b) => (b === 'cash' ? '/' : '/?basis=accrual')} />
      </PageHeader>

      <section aria-label="Resumo" className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Link
          href="/previsao"
          className={`flex flex-col gap-3 rounded-[18px] border p-6 text-ink no-underline lg:col-span-2 ${
            forecastVerdict === 'ok'
              ? 'border-transparent bg-primary-soft'
              : forecastVerdict === 'warn'
                ? 'border-warn-border bg-warn-soft'
                : 'border-transparent bg-danger-soft'
          }`}
        >
          <span className="flex items-center gap-2 text-xs font-extrabold tracking-wider text-ink-2 uppercase">
            <LineChart className="size-4" aria-hidden="true" />
            Previsão de caixa · 30 dias
          </span>
          <p className="text-xl leading-snug font-bold" data-testid="dashboard-verdict">
            {forecastVerdict === 'ok'
              ? 'Seus gastos previstos cabem no seu dinheiro.'
              : forecastVerdict === 'warn'
                ? 'Cabe, mas o saldo encosta na reserva mínima.'
                : `O saldo previsto fica negativo${forecast.base.firstNegative ? ` em ${shortDate(forecast.base.firstNegative)}` : ''}.`}
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              Menor saldo: <Money cents={forecast.base.min.balance} className="font-extrabold" /> em{' '}
              {shortDate(forecast.base.min.date)}
            </span>
            <span>
              Livre por dia: <Money cents={forecast.free.cents} className="font-extrabold" /> até{' '}
              {shortDate(forecast.free.until)}
            </span>
          </div>
        </Link>
        <Card className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-ink-2">Saldo em conta</span>
          <Money cents={balances.cashCents} className="text-[32px] font-extrabold tracking-tight" />
          <span className="text-[13px] text-ink-2">
            {balances.bank.map((b, i) => (
              <span key={b.id}>
                {i > 0 ? ' · ' : ''}
                {b.institution} <Money cents={b.balanceCents} />
              </span>
            ))}
          </span>
          {balances.investmentsCents > 0 ? (
            <span className="text-[13px] text-ink-2">
              Investimentos:{' '}
              <Money cents={balances.investmentsCents} className="font-bold text-ink" />
            </span>
          ) : null}
        </Card>
      </section>

      <section
        aria-label="Resumo do mês"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
      >
        <Card className="flex flex-col gap-1 p-4 lg:p-5">
          <span className="text-[13px] font-semibold text-ink-2">Receita do mês</span>
          <Money cents={current.incomeCents} className="text-lg font-extrabold lg:text-[22px]" />
        </Card>
        <Card className="flex flex-col gap-1 p-4 lg:p-5">
          <span className="text-[13px] font-semibold text-ink-2">Gasto do mês</span>
          <Money cents={current.expenseCents} className="text-lg font-extrabold lg:text-[22px]" />
          {spendDelta !== null ? (
            <span
              className={`text-xs font-bold ${spendDelta <= 0 ? 'text-primary-on-soft' : 'text-warn-ink dark:text-warn'}`}
            >
              Até o dia {day}: {Math.abs(spendDelta)}% {spendDelta <= 0 ? 'a menos' : 'a mais'} que
              em {prevMonthName}
            </span>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-1 p-4 lg:p-5">
          <span className="text-[13px] font-semibold text-ink-2">Sobra até agora</span>
          <Money cents={surplus} className="text-lg font-extrabold lg:text-[22px]" />
          {current.investedCents !== 0 ? (
            <span className="text-xs text-ink-2">
              investido no mês <Money cents={current.investedCents} />
            </span>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-1 p-4 lg:p-5">
          <span className="text-[13px] font-semibold text-ink-2">Taxa de poupança</span>
          <span className="text-lg font-extrabold lg:text-[22px]">
            {savingsRate !== null ? `${savingsRate}%` : '—'}
            <span className="text-[13px] font-semibold text-ink-2"> · meta {goal}%</span>
          </span>
          <div className="h-2 rounded bg-track" aria-hidden="true">
            <div
              className={`h-2 rounded ${savingsRate !== null && savingsRate >= goal ? 'bg-[#0b6e55]' : 'bg-warn'}`}
              style={{
                width: `${Math.max(0, Math.min(100, Math.round(((savingsRate ?? 0) / Math.max(goal, 1)) * 100)))}%`,
              }}
            />
          </div>
        </Card>
      </section>

      {reviewCount > 0 || budgetAlerts.length > 0 ? (
        <section aria-label="Avisos" className="flex flex-col gap-2">
          {reviewCount > 0 ? (
            <Link
              href="/revisao"
              className="flex items-center gap-3 rounded-[18px] border border-dashed border-ink-3 bg-surface p-4 text-ink no-underline"
            >
              <CircleAlert className="size-5 shrink-0 text-ink-2" aria-hidden="true" />
              <span className="flex-1 text-sm font-semibold text-ink-2">
                {reviewCount} {reviewCount === 1 ? 'transação aguardando' : 'transações aguardando'}{' '}
                sua confirmação de categoria
              </span>
              <span className="text-sm font-extrabold text-link">Revisar</span>
            </Link>
          ) : null}
          {budgetAlerts.slice(0, 3).map((b) => (
            <Link
              key={b.id}
              href="/orcamentos"
              className="flex items-center gap-3 rounded-[18px] border border-warn-border bg-warn-soft p-4 text-warn-ink no-underline"
            >
              <TriangleAlert className="size-5 shrink-0" aria-hidden="true" />
              <span className="flex-1 text-sm font-semibold">
                {b.label}: {Math.round(b.pace.usedRatio * 100)}% do orçamento
                {b.pace.status === 'exceeded'
                  ? ' — estourou'
                  : b.pace.projectedCents > b.pace.limitCents
                    ? ' — no ritmo atual, vai estourar'
                    : ''}
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      {topCategories.length ? (
        <Card className="flex flex-col gap-3">
          <div className="flex items-center">
            <CardTitle className="mr-auto">Para onde foi o dinheiro</CardTitle>
            <Link href="/categorias" className="text-[13px] font-bold">
              Categorias
            </Link>
          </div>
          <div className="flex flex-col gap-2.5">
            {topCategories.map(([id, cents]) => {
              const c = categories.find((x) => x.id === id);
              return (
                <Link
                  key={id ?? 'none'}
                  href={id ? `/transacoes?category=${id}` : '/revisao'}
                  className="flex items-center gap-3 text-sm text-ink no-underline"
                >
                  <span className="w-36 shrink-0 truncate font-semibold sm:w-44">
                    {c?.name ?? 'Sem categoria'}
                  </span>
                  <div className="h-3 flex-1 rounded bg-track" aria-hidden="true">
                    <div
                      className="h-3 rounded"
                      style={{
                        width: `${Math.round((cents / maxCat) * 100)}%`,
                        background: c?.color ?? '#94a3b8',
                      }}
                    />
                  </div>
                  <Money cents={cents} className="w-24 text-right font-bold" />
                </Link>
              );
            })}
          </div>
        </Card>
      ) : null}

      <section
        aria-label="Faturas e últimas transações"
        className="grid grid-cols-1 gap-5 lg:grid-cols-3"
      >
        <Card className="flex flex-col gap-1 lg:col-span-2">
          <div className="flex items-center pb-2">
            <CardTitle className="mr-auto">Últimas transações</CardTitle>
            <Link href="/transacoes" className="text-[13px] font-bold">
              Ver todas
            </Link>
          </div>
          {recent.rows.slice(0, 8).map((t) => (
            <TransactionRow key={t.id} t={t} />
          ))}
        </Card>
        <div className="flex flex-col gap-3">
          <h2 className="text-base font-extrabold">Faturas abertas</h2>
          {bills.length === 0 ? (
            <p className="text-sm text-ink-2">Nenhuma fatura em aberto.</p>
          ) : null}
          {bills.map((b) => {
            const card = balances.cards.find((c) => c.id === b.accountId);
            return (
              <Card key={b.accountId} className="flex flex-col gap-2 p-5">
                <div className="flex items-center gap-2">
                  <span className="mr-auto font-extrabold">
                    {b.institution} · {b.accountName}
                  </span>
                  {b.closingDate ? (
                    <span className="text-xs font-bold text-ink-2">
                      fecha {shortDate(b.closingDate)}
                    </span>
                  ) : null}
                </div>
                <Money cents={b.totalCents} className="text-2xl font-extrabold" />
                <span className="text-[13px] text-ink-2">vence {shortDate(b.dueDate)}</span>
                {card?.creditLimitCents ? (
                  <>
                    <div className="h-2 rounded bg-track" aria-hidden="true">
                      <div
                        className="h-2 rounded bg-ink"
                        style={{
                          width: `${Math.min(100, Math.round((1 - (card.availableLimitCents ?? 0) / card.creditLimitCents) * 100))}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs text-ink-2">
                      Limite disponível <Money cents={card.availableLimitCents ?? 0} /> de{' '}
                      <Money cents={card.creditLimitCents} />
                    </span>
                  </>
                ) : null}
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
