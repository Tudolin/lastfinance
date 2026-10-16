'use client';

import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react';
import { useActionState, useState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { ForecastChart } from '@/components/forecast/forecast-chart';
import { Money } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { cn } from '@/lib/cn';
import { createPlannedAction, simulateAction } from '../previsao/actions';
import { PaymentFields } from '../planejados/planned-client';

const VERDICT = {
  ok: { icon: CircleCheck, title: 'Pode gastar', cls: 'bg-primary-soft text-primary-on-soft' },
  warn: {
    icon: TriangleAlert,
    title: 'Cabe, com cuidado',
    cls: 'bg-warn-soft text-warn-ink border border-warn-border',
  },
  no: { icon: CircleX, title: 'Melhor não agora', cls: 'bg-danger-soft text-danger-ink' },
} as const;

export function CanSpendForm({
  accounts,
  today,
}: {
  accounts: { id: string; name: string; kind: string }[];
  today: string;
}) {
  const [state, action, pending] = useActionState(simulateAction, undefined);
  const [planState, planAction, planning] = useActionState(createPlannedAction, undefined);
  const [method, setMethod] = useState<'pix' | 'debit' | 'credit'>('pix');
  const [last, setLast] = useState<FormData | null>(null);
  const r = state?.ok ? state.data : null;
  const v = r ? VERDICT[r.verdict] : null;

  return (
    <div className="flex flex-col gap-5">
      <form
        action={(fd) => {
          setLast(fd);
          action(fd);
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Simular compra"
      >
        <Field label="Valor (R$)" htmlFor="sim-amount">
          <Input
            id="sim-amount"
            name="amount"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            required
            autoFocus
          />
        </Field>
        <Field label="O que é (opcional)" htmlFor="sim-desc">
          <Input id="sim-desc" name="description" placeholder="Ex.: Fone novo" />
        </Field>
        <Field label="Data" htmlFor="sim-date">
          <Input id="sim-date" name="date" type="date" defaultValue={today} />
        </Field>
        <PaymentFields accounts={accounts} prefix="sim" method={method} setMethod={setMethod} />
        <div className="flex items-end sm:col-span-2 lg:col-span-3">
          <Button type="submit" size="lg" disabled={pending} className="w-full sm:w-auto">
            {pending ? 'Calculando…' : 'Posso gastar?'}
          </Button>
        </div>
      </form>
      {state && !state.ok ? <FormError message={state.error} /> : null}

      {r && v ? (
        <section aria-live="polite" className="flex flex-col gap-4">
          <div
            className={cn('flex flex-col gap-2 rounded-[18px] p-5', v.cls)}
            data-testid="verdict"
            data-verdict={r.verdict}
          >
            <span className="flex items-center gap-2 text-xl font-extrabold">
              <v.icon className="size-6" aria-hidden="true" />
              {v.title}
            </span>
            <ul className="flex flex-col gap-1 text-sm font-semibold">
              {r.reasons.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-ink-2">Menor saldo antes</dt>
              <dd className="font-extrabold">
                <Money cents={r.before.min.balance} />
              </dd>
              <dd className="text-xs text-ink-2">{formatBR(r.before.min.date as LocalDate)}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-ink-2">Menor saldo depois</dt>
              <dd className="font-extrabold">
                <Money cents={r.after.min.balance} />
              </dd>
              <dd className="text-xs text-ink-2">{formatBR(r.after.min.date as LocalDate)}</dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-ink-2">No conservador</dt>
              <dd className="font-extrabold">
                <Money cents={r.conservativeMin.balance} />
              </dd>
            </div>
            <div className="rounded-xl bg-surface-2 p-3">
              <dt className="text-ink-2">Reserva mínima</dt>
              <dd className="font-extrabold">
                <Money cents={r.reserveCents} />
              </dd>
            </div>
          </dl>
          <ForecastChart
            points={r.series.before.map((b, i) => ({
              date: b.date,
              actual: b.balance,
              base: r.series.after[i]?.balance ?? null,
              low: null,
              high: null,
            }))}
            reserveCents={r.reserveCents}
            legend={{ actual: 'sem a compra', base: 'com a compra' }}
            label="Saldo previsto com e sem a compra"
          />
          {r.purchaseEvents.length > 1 ? (
            <ul className="text-sm text-ink-2">
              {r.purchaseEvents.map((e) => (
                <li key={e.date}>
                  {formatBR(e.date as LocalDate)}: <Money cents={e.cents} signed /> ({e.label})
                </li>
              ))}
            </ul>
          ) : null}
          {last ? (
            <form action={planAction} className="flex flex-wrap items-center gap-2">
              <input
                type="hidden"
                name="description"
                value={String(last.get('description') || 'Compra planejada')}
              />
              <input type="hidden" name="amount" value={String(last.get('amount'))} />
              <input type="hidden" name="date" value={String(last.get('date') || today)} />
              <input type="hidden" name="paymentMethod" value={String(last.get('method'))} />
              <input
                type="hidden"
                name="installments"
                value={String(last.get('installments') ?? 1)}
              />
              <input type="hidden" name="accountId" value={String(last.get('accountId') ?? '')} />
              <Button type="submit" variant="outline" disabled={planning || planState?.ok}>
                {planState?.ok
                  ? 'Adicionado aos planejados'
                  : 'Vou comprar: adicionar aos planejados'}
              </Button>
              {planState && !planState.ok ? <FormError message={planState.error} /> : null}
            </form>
          ) : null}
        </section>
      ) : (
        <Notice>
          A resposta usa a mesma previsão da tela de Previsão: saldo de hoje, renda prevista,
          recorrências, faturas, parcelas e o seu gasto variável médio.
        </Notice>
      )}
    </div>
  );
}
