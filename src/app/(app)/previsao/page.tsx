import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  ListChecks,
  Repeat,
  ShoppingBag,
  Briefcase,
} from 'lucide-react';
import Link from 'next/link';
import { ForecastChart } from '@/components/forecast/forecast-chart';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { cn } from '@/lib/cn';
import { monthName, weekdayDate } from '@/lib/format';
import { getForecastView, getMonthlyPlanVsActual } from '@/server/queries/forecast';
import { RefreshPlanningButton } from './planning-client';

export const metadata = { title: 'Previsão de caixa' };

const HORIZONS = [30, 60, 90] as const;
const VARIABLE_LABEL = {
  avg3: 'média de 3 meses',
  avg6: 'média de 6 meses',
  budget: 'orçamentos do mês',
};

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const raw = Number((await searchParams).dias);
  const days = (HORIZONS as readonly number[]).includes(raw) ? (raw as 30 | 60 | 90) : 90;
  const [v, monthly] = await Promise.all([getForecastView(days), getMonthlyPlanVsActual()]);
  const verdict =
    v.base.min.balance < 0 ? 'no' : v.base.min.balance < v.reserveCents ? 'warn' : 'ok';
  const byDay = new Map<string, typeof v.upcoming>();
  for (const e of v.upcoming.slice(0, 60)) byDay.set(e.day, [...(byDay.get(e.day) ?? []), e]);
  const hasPlan = v.upcoming.some((e) => e.kind === 'income');
  // Último dia negativo da primeira sequência e o dia em que o saldo volta ao positivo.
  const firstNeg = v.base.firstNegative;
  const negStart = firstNeg ? v.daily.findIndex((d) => d.date === firstNeg) : -1;
  const backIdx = negStart >= 0 ? v.daily.findIndex((d, i) => i > negStart && d.balance >= 0) : -1;
  const recovery = backIdx > 0 ? v.daily[backIdx]! : null;
  const lastNeg = backIdx > 0 ? v.daily[backIdx - 1]! : null;
  const shortfall = Math.max(0, v.reserveCents - v.free.minBalance);

  return (
    <>
      <PageHeader title="Previsão de caixa" kicker={`Próximos ${days} dias`}>
        <nav aria-label="Horizonte" className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {HORIZONS.map((h) => (
            <Link
              key={h}
              href={`/previsao?dias=${h}`}
              aria-current={h === days ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-bold no-underline',
                h === days ? 'bg-surface text-ink shadow-sm' : 'text-ink-2',
              )}
            >
              {h} dias
            </Link>
          ))}
        </nav>
      </PageHeader>

      {!hasPlan ? (
        <Notice tone="warn">
          Nenhuma renda prevista no período. Cadastre suas fontes de renda em{' '}
          <Link href="/renda">Renda</Link> e confirme as recorrências em{' '}
          <Link href="/recorrencias">Recorrências</Link> para a previsão ficar completa.
        </Notice>
      ) : null}

      <section
        aria-label="Veredito"
        className={cn(
          'flex flex-col gap-2 rounded-[18px] border p-5',
          verdict === 'ok' && 'border-transparent bg-primary-soft text-primary-on-soft',
          verdict === 'warn' && 'border-warn-border bg-warn-soft text-warn-ink',
          verdict === 'no' && 'border-transparent bg-danger-soft text-danger-ink',
        )}
      >
        <p className="text-lg font-extrabold">
          {verdict === 'ok'
            ? `Seus gastos previstos cabem no seu dinheiro pelos próximos ${days} dias.`
            : verdict === 'warn'
              ? 'Cabe, mas o saldo encosta na sua reserva mínima.'
              : !firstNeg
                ? 'O saldo previsto fica negativo.'
                : !recovery
                  ? `O saldo previsto fica negativo a partir de ${formatBR(firstNeg)} e não volta ao positivo no período.`
                  : lastNeg && lastNeg.date !== firstNeg
                    ? `O saldo previsto fica negativo de ${formatBR(firstNeg)} a ${formatBR(lastNeg.date as LocalDate)} e volta ao positivo em ${formatBR(recovery.date as LocalDate)}.`
                    : `O saldo previsto fica negativo em ${formatBR(firstNeg)} e volta ao positivo em ${formatBR(recovery.date as LocalDate)}.`}
        </p>
        <p className="text-sm font-semibold">
          Menor saldo previsto: <Money cents={v.base.min.balance} className="font-extrabold" /> em{' '}
          {formatBR(v.base.min.date)} · margem sobre a reserva:{' '}
          <Money cents={v.base.min.balance - v.reserveCents} className="font-extrabold" signed />
        </p>
      </section>

      <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Saldo hoje</span>
          <Money cents={v.startBalance} className="text-xl font-extrabold" />
          <ul className="flex flex-col gap-0.5 text-xs text-ink-2">
            {v.cashAccounts.map((a) => (
              <li key={a.id} className="flex items-baseline gap-2">
                <span className="line-clamp-2 min-w-0 flex-1 break-words" title={a.name}>
                  {a.name}
                </span>
                <Money cents={a.balanceCents} />
              </li>
            ))}
          </ul>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Livre para gastar por dia</span>
          <Money cents={v.free.cents} className="text-xl font-extrabold" />
          <span className="text-xs text-ink-2">
            {v.free.cents === 0 && shortfall > 0 ? (
              <>
                faltam <Money cents={shortfall} className="font-bold" /> para manter a reserva de{' '}
                <Money cents={v.reserveCents} /> até {formatBR(v.free.until)}
              </>
            ) : (
              <>
                até {formatBR(v.free.until)} ({v.free.days} dias), mantendo a reserva de{' '}
                <Money cents={v.reserveCents} />
              </>
            )}
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Saldo em {days} dias</span>
          <Money cents={v.base.end} className="text-xl font-extrabold" />
          <span className="text-xs text-ink-2">
            conservador <Money cents={v.conservative.end} /> · otimista{' '}
            <Money cents={v.optimistic.end} />
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Dias no negativo</span>
          <span className="text-xl font-extrabold">{v.base.negativeDays}</span>
          <span className="text-xs text-ink-2">
            no conservador: {v.conservative.negativeDays} · pior caso{' '}
            <Money cents={v.base.minLow.balance} />
          </span>
        </Card>
      </section>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="mr-auto">Saldo dia a dia</CardTitle>
          <span className="text-xs text-ink-2">
            Gasto variável estimado: <Money cents={v.variableMonthlyCents} />
            /mês ({VARIABLE_LABEL[v.variableSource]})
          </span>
        </div>
        <ForecastChart
          points={v.chart}
          reserveCents={v.reserveCents}
          showScenarios
          label={`Saldo realizado nos últimos 30 dias e previsto para os próximos ${days}. Menor saldo previsto ${formatBR(v.base.min.date)}.`}
        />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card className="flex flex-col gap-3 lg:col-span-3">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-5 text-ink-2" aria-hidden="true" />
            <CardTitle className="mr-auto">Próximos movimentos</CardTitle>
          </div>
          {byDay.size === 0 ? (
            <p className="text-sm text-ink-2">Nada previsto no período.</p>
          ) : (
            <ol className="flex flex-col">
              {[...byDay.entries()].map(([day, evs]) => (
                <li key={day} className="border-t border-surface-2 py-2 first:border-t-0">
                  <span className="text-xs font-extrabold tracking-wide text-ink-2 uppercase">
                    {weekdayDate(day as LocalDate, false)}
                  </span>
                  <ul className="mt-1 flex flex-col gap-1">
                    {evs.map((e, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        {e.cents > 0 ? (
                          <ArrowUpRight
                            className="size-4 shrink-0 text-primary-on-soft"
                            aria-hidden="true"
                          />
                        ) : (
                          <ArrowDownRight
                            className="size-4 shrink-0 text-ink-2"
                            aria-hidden="true"
                          />
                        )}
                        <span
                          className={cn(
                            'flex-1 font-semibold',
                            e.kind === 'overdue' && 'text-warn-ink dark:text-warn',
                          )}
                        >
                          {e.label}
                          {e.estimated ? (
                            <span className="ml-1 text-xs font-medium text-ink-2">(estimado)</span>
                          ) : null}
                        </span>
                        <Money cents={e.cents} signed tone="auto" className="font-bold" />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <div className="flex flex-col gap-5 lg:col-span-2">
          <Card className="flex flex-col gap-1 py-2">
            {[
              {
                href: '/previsao/conciliacao',
                label: 'Conciliação (previsto × realizado)',
                icon: ListChecks,
              },
              { href: '/renda', label: 'Fontes de renda', icon: Briefcase },
              { href: '/recorrencias', label: 'Recorrências', icon: Repeat },
              { href: '/planejados', label: 'Gastos planejados', icon: ShoppingBag },
            ].map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="flex min-h-11 items-center gap-3 font-bold text-ink no-underline"
              >
                <l.icon className="size-5 text-ink-2" aria-hidden="true" />
                {l.label}
              </Link>
            ))}
            <div className="pt-2">
              <RefreshPlanningButton />
            </div>
          </Card>
        </div>
      </div>

      <Card className="flex flex-col gap-3 overflow-x-auto">
        <CardTitle>Previsto × Realizado por mês</CardTitle>
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-2">
              <th className="py-2 font-bold">Mês</th>
              <th className="py-2 text-right font-bold">Renda prevista</th>
              <th className="py-2 text-right font-bold">Renda real</th>
              <th className="py-2 text-right font-bold">Δ</th>
              <th className="py-2 text-right font-bold">Saídas planejadas</th>
              <th className="py-2 text-right font-bold">Gasto total real</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((m) => {
              const [y, mm] = m.month.split('-').map(Number) as [number, number];
              const delta = m.income.actual != null ? m.income.actual - m.income.planned : null;
              return (
                <tr
                  key={m.month}
                  className={cn('border-t border-surface-2', m.isCurrent && 'font-bold')}
                >
                  <td className="py-2 capitalize">
                    {monthName(mm)} {y}
                    {m.late ? (
                      <span className="ml-1 text-xs text-warn-ink dark:text-warn">
                        · {m.late} atrasado(s)
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-right">
                    <Money cents={m.income.planned} />
                  </td>
                  <td className="py-2 text-right">
                    {m.income.actual != null ? <Money cents={m.income.actual} /> : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {delta != null ? <Money cents={delta} signed tone="auto" /> : '—'}
                  </td>
                  <td className="py-2 text-right">
                    <Money cents={m.plannedExpenses.planned} />
                  </td>
                  <td className="py-2 text-right">
                    {m.totalExpenses != null ? <Money cents={m.totalExpenses} /> : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="text-xs text-ink-2">
          Renda real pelo regime de caixa; gasto total pela data da compra. O mês corrente ainda
          está em andamento.
        </p>
      </Card>
    </>
  );
}
