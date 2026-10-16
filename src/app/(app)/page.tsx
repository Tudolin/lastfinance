import { Landmark, LineChart } from 'lucide-react';
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

  const [balances, bills, current, previous, recent] = await Promise.all([
    getBalances(),
    getOpenBills(today),
    summarize(monthStart, today, basis),
    summarize(prevStart, prevSameDay, basis),
    listTransactions({ basis: 'cash', page: 1 }),
  ]);
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
        <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-surface-2 p-6 lg:col-span-2">
          <span className="flex items-center gap-2 text-xs font-extrabold tracking-wider text-ink-2 uppercase">
            <LineChart className="size-4" aria-hidden="true" />
            Previsão de caixa
          </span>
          <p className="text-xl leading-snug font-bold">
            “Meus gastos futuros cabem no meu dinheiro?”
          </p>
          <p className="text-sm text-ink-2">
            O veredito, o dia de menor saldo e o “livre para gastar” chegam na Fase 3, quando entram
            receitas previstas, recorrências e parcelas futuras. Os dados abaixo já são reais.
          </p>
        </div>
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
          </span>
          <span className="text-xs text-ink-2">meta configurável na Fase 2</span>
        </Card>
      </section>

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
