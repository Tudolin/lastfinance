import { CalendarCheck } from 'lucide-react';
import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { bestPurchaseDay } from '@/domain/cards/billing-cycle';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { monthName, shortDate } from '@/lib/format';
import { getCardsOverview } from '@/server/queries/planning';

export const metadata = { title: 'Cartões' };

function monthLabel(ym: string) {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return `${monthName(m).slice(0, 3)}/${String(y).slice(2)}`;
}

export default async function CardsPage() {
  const data = await getCardsOverview();
  if (data.cards.length === 0) {
    return (
      <>
        <PageHeader title="Cartões" />
        <Card className="text-ink-2">
          Nenhum cartão conectado. <Link href="/contas">Conectar instituição</Link>
        </Card>
      </>
    );
  }
  const maxCommit = Math.max(1, ...data.commitment.map((c) => c.cents));
  return (
    <>
      <PageHeader title="Cartões" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {data.cards.map((c) => {
          const upcomingByBill = new Map<string, number>();
          for (const i of c.upcomingInstallments)
            upcomingByBill.set(i.dueDate, (upcomingByBill.get(i.dueDate) ?? 0) + i.amountCents);
          return (
            <Card key={c.id} className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <CardTitle className="mr-auto">
                  {c.institution} · {c.name}
                </CardTitle>
                {c.closingDay ? (
                  <span className="text-xs font-bold text-ink-2">
                    fecha dia {c.closingDay} · vence dia {c.dueDay}
                  </span>
                ) : null}
              </div>
              {c.currentBill ? (
                <div className="flex flex-col gap-1">
                  <span className="text-[13px] font-semibold text-ink-2">Fatura atual</span>
                  <Money
                    cents={c.currentBill.totalCents}
                    className="text-[28px] font-extrabold tracking-tight"
                  />
                  <span className="text-[13px] text-ink-2">
                    vence {formatBR(c.currentBill.dueDate as LocalDate)}
                    {c.currentBill.closingDate
                      ? ` · fecha ${shortDate(c.currentBill.closingDate)}`
                      : ''}
                    {c.currentBill.minimumPaymentCents ? (
                      <>
                        {' '}
                        · mínimo <Money cents={c.currentBill.minimumPaymentCents} />
                      </>
                    ) : null}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-ink-2">Sem fatura em aberto.</p>
              )}
              {c.creditLimitCents ? (
                <div className="flex flex-col gap-1.5">
                  <div className="h-2 rounded bg-track" aria-hidden="true">
                    <div
                      className="h-2 rounded bg-ink"
                      style={{
                        width: `${Math.min(100, Math.round((1 - (c.availableLimitCents ?? 0) / c.creditLimitCents) * 100))}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-ink-2">
                    Limite disponível <Money cents={c.availableLimitCents ?? 0} /> de{' '}
                    <Money cents={c.creditLimitCents} />
                  </span>
                </div>
              ) : null}
              {c.closingDay ? (
                <div className="flex items-center gap-2 rounded-xl bg-primary-soft p-3 text-sm text-primary-on-soft">
                  <CalendarCheck className="size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>
                      Melhor dia de compra:{' '}
                      {bestPurchaseDay({
                        closingDay: c.closingDay,
                        dueDay: c.dueDay ?? c.closingDay,
                      })}
                    </strong>{' '}
                    — compras a partir do fechamento só entram na fatura seguinte, com o maior prazo
                    até o pagamento.
                  </span>
                </div>
              ) : null}
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-extrabold">
                  Próximas faturas (parcelas já contratadas)
                </h3>
                {upcomingByBill.size === 0 ? (
                  <p className="text-sm text-ink-2">Nenhuma parcela futura.</p>
                ) : null}
                {[...upcomingByBill.entries()].slice(0, 6).map(([due, cents]) => (
                  <div
                    key={due}
                    className="flex items-center border-t border-surface-2 py-2 text-sm first:border-t-0"
                  >
                    <span className="flex-1">vence {formatBR(due as LocalDate)}</span>
                    <Money cents={cents} className="font-bold" />
                  </div>
                ))}
                {c.upcomingInstallments.length ? (
                  <details className="mt-1 text-sm">
                    <summary className="cursor-pointer font-bold text-ink-2">
                      Ver parcelas ({c.upcomingInstallments.length})
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {c.upcomingInstallments.map((i) => (
                        <li
                          key={`${i.description}-${i.number}-${i.dueDate}`}
                          className="flex gap-2"
                        >
                          <span className="flex-1">
                            {i.description} {i.number}/{i.total}
                          </span>
                          <span className="text-ink-2">{shortDate(i.dueDate)}</span>
                          <Money cents={i.amountCents} />
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
      <Card className="flex flex-col gap-3">
        <CardTitle>Comprometimento futuro</CardTitle>
        <p className="text-sm text-ink-2">
          Quanto da sua renda média (últimos 3 meses: <Money cents={data.monthlyIncomeCents} />) já
          está tomada por parcelas nos próximos meses.
        </p>
        {data.commitment.length === 0 ? (
          <p className="text-sm text-ink-2">Nenhuma parcela futura.</p>
        ) : null}
        <div className="flex flex-col gap-2">
          {data.commitment.map((m) => (
            <div key={m.month} className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 font-bold">{monthLabel(m.month)}</span>
              <div className="h-3 flex-1 rounded bg-track" aria-hidden="true">
                <div
                  className="h-3 rounded bg-ink"
                  style={{ width: `${Math.round((m.cents / maxCommit) * 100)}%` }}
                />
              </div>
              <Money cents={m.cents} className="w-24 text-right font-bold" />
              <span className="w-12 text-right text-ink-2">
                {m.ratio != null ? `${Math.round(m.ratio * 100)}%` : '—'}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
