'use client';

import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useMemo, useState, useTransition } from 'react';
import { ForecastChart } from '@/components/forecast/forecast-chart';
import { Money } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { addMonths, formatBR, localDate, type LocalDate } from '@/domain/dates/local-date';
import { simulateFinancing, type AmortizationSystem } from '@/domain/scenarios/financing';
import { cn } from '@/lib/cn';
import { simulateScenarioAction, type ScenarioResult } from './actions';

const VERDICT = {
  ok: {
    icon: CircleCheck,
    title: 'Cabe no seu caixa',
    cls: 'bg-primary-soft text-primary-on-soft',
  },
  warn: {
    icon: TriangleAlert,
    title: 'Cabe, mas encosta na reserva',
    cls: 'bg-warn-soft text-warn-ink border border-warn-border',
  },
  no: { icon: CircleX, title: 'O saldo fica negativo', cls: 'bg-danger-soft text-danger-ink' },
} as const;

const pct = (x: number | null) =>
  x == null ? '—' : `${(x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export function FinancingSimulator({ today }: { today: string }) {
  const [f, setF] = useState({
    price: '70000',
    down: '10000',
    rate: '1.69',
    months: '48',
    contract: today,
    insurance: '0',
    fees: '0',
    iof: true,
  });
  const [chosen, setChosen] = useState<AmortizationSystem>('price');
  const [impact, setImpact] = useState<ScenarioResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setImpact(null);
    setF((cur) => ({
      ...cur,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }));
  };

  const valid =
    num(f.price) > num(f.down) && num(f.months) >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(f.contract);
  const results = useMemo(() => {
    if (!valid) return null;
    const base = {
      principalCents: Math.round((num(f.price) - num(f.down)) * 100),
      monthlyRatePct: num(f.rate),
      months: Math.min(420, Math.round(num(f.months))),
      contractDate: localDate(f.contract),
      insuranceMonthlyPct: num(f.insurance),
      feesCents: Math.round(num(f.fees) * 100),
      iof: f.iof,
    };
    return {
      price: simulateFinancing({ ...base, system: 'price' }),
      sac: simulateFinancing({ ...base, system: 'sac' }),
    };
  }, [f, valid]);

  function checkCash() {
    setError(null);
    start(async () => {
      const r = await simulateScenarioAction([
        {
          type: 'financing',
          label: 'Financiamento',
          assetPrice: num(f.price),
          downPayment: num(f.down),
          monthlyRatePct: num(f.rate),
          months: Math.round(num(f.months)),
          system: chosen,
          contractDate: f.contract,
          insuranceMonthlyPct: num(f.insurance) || undefined,
          fees: num(f.fees) || undefined,
          iof: f.iof,
        },
      ]);
      if (r.ok) setImpact(r.data);
      else setError(r.error);
    });
  }

  const rows = results ? results[chosen].installments : [];
  const v = impact ? VERDICT[impact.verdict as keyof typeof VERDICT] : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <form
          aria-label="Simular financiamento"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            checkCash();
          }}
        >
          <Field label="Preço do bem (R$)" htmlFor="fin-price">
            <Input id="fin-price" inputMode="decimal" value={f.price} onChange={set('price')} />
          </Field>
          <Field label="Entrada (R$)" htmlFor="fin-down">
            <Input id="fin-down" inputMode="decimal" value={f.down} onChange={set('down')} />
          </Field>
          <Field label="Juros ao mês (%)" htmlFor="fin-rate">
            <Input id="fin-rate" inputMode="decimal" value={f.rate} onChange={set('rate')} />
          </Field>
          <Field label="Prazo (meses)" htmlFor="fin-months">
            <Input id="fin-months" inputMode="numeric" value={f.months} onChange={set('months')} />
          </Field>
          <Field label="Contrato" htmlFor="fin-contract" hint="1ª parcela um mês depois">
            <Input id="fin-contract" type="date" value={f.contract} onChange={set('contract')} />
          </Field>
          <Field label="Seguro (% a.m. do saldo)" htmlFor="fin-ins">
            <Input
              id="fin-ins"
              inputMode="decimal"
              value={f.insurance}
              onChange={set('insurance')}
            />
          </Field>
          <Field label="Tarifas (R$)" htmlFor="fin-fees" hint="Cadastro, registro, avaliação">
            <Input id="fin-fees" inputMode="decimal" value={f.fees} onChange={set('fees')} />
          </Field>
          <label className="flex items-center gap-2 self-center pt-5 text-sm font-bold">
            <input type="checkbox" checked={f.iof} onChange={set('iof')} className="size-5" />
            Cobrar IOF
          </label>
        </form>
      </Card>

      {results ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="Price e SAC">
          {(['price', 'sac'] as const).map((s) => {
            const r = results[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setChosen(s);
                  setImpact(null);
                }}
                aria-pressed={chosen === s}
                data-testid={`fin-${s}`}
                className={cn(
                  'flex flex-col gap-2 rounded-[18px] border bg-surface p-5 text-left',
                  chosen === s ? 'border-ink ring-2 ring-ink' : 'border-border',
                )}
              >
                <span className="text-[13px] font-bold text-ink-2">
                  {s === 'price' ? 'Tabela Price (parcelas iguais)' : 'SAC (parcelas decrescentes)'}
                </span>
                <span className="text-2xl font-extrabold">
                  <Money cents={r.firstPaymentCents} />
                  {s === 'sac' ? (
                    <span className="text-base font-bold text-ink-2">
                      {' '}
                      → <Money cents={r.lastPaymentCents} />
                    </span>
                  ) : null}
                </span>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <dt className="text-ink-2">Total pago</dt>
                  <dd className="text-right font-bold">
                    <Money cents={r.totalPaidCents} />
                  </dd>
                  <dt className="text-ink-2">Juros</dt>
                  <dd className="text-right font-bold">
                    <Money cents={r.totalInterestCents} />
                  </dd>
                  <dt className="text-ink-2">IOF</dt>
                  <dd className="text-right font-bold">
                    <Money cents={r.iofCents} />
                  </dd>
                  <dt className="text-ink-2">CET</dt>
                  <dd className="text-right font-bold" data-testid={`cet-${s}`}>
                    {pct(r.cetMonthly)} a.m. · {pct(r.cetAnnual)} a.a.
                  </dd>
                </dl>
              </button>
            );
          })}
        </section>
      ) : (
        <Notice tone="warn">Preencha preço maior que a entrada, prazo e data do contrato.</Notice>
      )}

      {results ? (
        <Card className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="mr-auto">Cabe no meu caixa?</CardTitle>
            <Button onClick={checkCash} disabled={pending}>
              {pending ? 'Calculando…' : `Ver impacto (${chosen === 'price' ? 'Price' : 'SAC'})`}
            </Button>
          </div>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {impact && v ? (
            <div className="flex flex-col gap-3" aria-live="polite">
              <div
                className={cn(
                  'flex items-center gap-2 rounded-xl p-4 text-lg font-extrabold',
                  v.cls,
                )}
                data-testid="scenario-verdict"
              >
                <v.icon className="size-6" aria-hidden="true" /> {v.title}
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div className="rounded-xl bg-surface-2 p-3">
                  <dt className="text-ink-2">Menor saldo hoje</dt>
                  <dd className="font-extrabold">
                    <Money cents={impact.before.min.balance} />
                  </dd>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <dt className="text-ink-2">Com o financiamento</dt>
                  <dd className="font-extrabold">
                    <Money cents={impact.after.min.balance} />
                  </dd>
                  <dd className="text-xs text-ink-2">
                    {formatBR(impact.after.min.date as LocalDate)}
                  </dd>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <dt className="text-ink-2">Dias no negativo</dt>
                  <dd className="font-extrabold">{impact.after.negativeDays}</dd>
                </div>
                <div className="rounded-xl bg-surface-2 p-3">
                  <dt className="text-ink-2">Saldo em 12 meses</dt>
                  <dd className="font-extrabold">
                    <Money cents={impact.after.end} />
                  </dd>
                </div>
              </dl>
              <ForecastChart
                points={impact.series.map((p) => ({
                  date: p.date,
                  actual: p.before,
                  base: p.after,
                  low: null,
                  high: null,
                }))}
                reserveCents={impact.reserveCents}
                legend={{ actual: 'sem o financiamento', base: 'com o financiamento' }}
                label="Saldo previsto com e sem o financiamento"
              />
            </div>
          ) : (
            <p className="text-sm text-ink-2">
              Soma a entrada e as parcelas à sua previsão de caixa dos próximos 12 meses e mostra o
              menor saldo.
            </p>
          )}
        </Card>
      ) : null}

      {results ? (
        <Card>
          <details>
            <summary className="cursor-pointer font-extrabold">
              Tabela de parcelas ({chosen === 'price' ? 'Price' : 'SAC'})
            </summary>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="sticky top-0 bg-surface text-left text-ink-2">
                  <tr>
                    <th className="py-1.5 pr-2">#</th>
                    <th className="pr-2">Vencimento</th>
                    <th className="pr-2 text-right">Parcela</th>
                    <th className="pr-2 text-right">Juros</th>
                    <th className="pr-2 text-right">Amortização</th>
                    <th className="text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.n} className="border-t border-surface-2">
                      <td className="py-1.5 pr-2">{r.n}</td>
                      <td className="pr-2">{formatBR(r.date)}</td>
                      <td className="pr-2 text-right">
                        <Money cents={r.paymentCents} />
                      </td>
                      <td className="pr-2 text-right">
                        <Money cents={r.interestCents} />
                      </td>
                      <td className="pr-2 text-right">
                        <Money cents={r.amortizationCents} />
                      </td>
                      <td className="text-right">
                        <Money cents={r.balanceCents} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-ink-2">
              IOF de pessoa física: 0,38% + 0,0082% ao dia (até 365 dias) sobre cada amortização,
              financiado junto. Última parcela em{' '}
              {rows.length
                ? formatBR(rows.at(-1)!.date)
                : formatBR(addMonths(localDate(f.contract), 1))}
              .
            </p>
          </details>
        </Card>
      ) : null}
    </div>
  );
}
