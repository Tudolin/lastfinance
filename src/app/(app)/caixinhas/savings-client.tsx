'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Money } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  projectGrowth,
  projectTaxFree,
  requiredMonthly,
  savingsAccountAnnual,
} from '@/domain/investments/yield';
import {
  createGoalAction,
  deleteGoalAction,
  setEmergencyMonthsAction,
  setGoalSavedAction,
  setGoalStatusAction,
} from './actions';

const selectCls =
  'min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink';
const num = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const pctStr = (x: number) => (x * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

export function GoalForm({ investments }: { investments: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createGoalAction, undefined);
  const [linked, setLinked] = useState('');
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Nova meta">
      <Field label="Nome" htmlFor="goal-name">
        <Input id="goal-name" name="name" required placeholder="Ex.: Viagem de fim de ano" />
      </Field>
      <Field label="Quanto quer juntar (R$)" htmlFor="goal-target">
        <Input
          id="goal-target"
          name="target"
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          required
        />
      </Field>
      <Field label="Até quando (opcional)" htmlFor="goal-date">
        <Input id="goal-date" name="targetDate" type="date" />
      </Field>
      <Field
        label="Onde está guardado"
        htmlFor="goal-inv"
        hint="Vinculada a um investimento, a meta acompanha o saldo dele sozinha."
      >
        <select
          id="goal-inv"
          name="investmentId"
          className={selectCls}
          value={linked}
          onChange={(e) => setLinked(e.target.value)}
        >
          <option value="">Informo à mão</option>
          {investments.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </select>
      </Field>
      {linked ? null : (
        <Field label="Já guardado (R$)" htmlFor="goal-saved">
          <Input
            id="goal-saved"
            name="saved"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            defaultValue="0"
          />
        </Field>
      )}
      {state && !state.ok ? <FormError message={state.error} /> : null}
      <Button type="submit" disabled={pending}>
        Criar meta
      </Button>
    </form>
  );
}

export function GoalButtons({
  id,
  name,
  manual,
  savedCents,
  status,
}: {
  id: string;
  name: string;
  manual: boolean;
  savedCents: number;
  status: 'active' | 'done' | 'archived';
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(savedCents / 100));
  const [error, setError] = useState<string | null>(null);
  const go = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setError(r.ok ? null : (r.error ?? 'Não deu certo.'));
      if (r.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  if (editing)
    return (
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          go(() => setGoalSavedAction(id, num(value)));
        }}
      >
        <Field label="Guardado (R$)" htmlFor={`saved-${id}`}>
          <Input
            id={`saved-${id}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-36"
          />
        </Field>
        <Button type="submit" size="sm" disabled={pending}>
          Salvar
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
        {error ? <FormError message={error} /> : null}
      </form>
    );
  return (
    <div className="flex flex-wrap gap-1">
      {manual && status === 'active' ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setEditing(true)}
          aria-label={`Atualizar valor guardado de ${name}`}
        >
          Atualizar valor
        </Button>
      ) : null}
      {status === 'active' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => go(() => setGoalStatusAction(id, 'done'))}
          aria-label={`Concluir ${name}`}
        >
          Concluída
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => go(() => setGoalStatusAction(id, 'active'))}
          aria-label={`Reabrir ${name}`}
        >
          Reabrir
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => go(() => deleteGoalAction(id))}
        aria-label={`Apagar ${name}`}
      >
        Apagar
      </Button>
      {error ? <FormError message={error} /> : null}
    </div>
  );
}

export function EmergencyMonths({ months }: { months: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-sm text-ink-2">
      Meta de
      <select
        aria-label="Meses de reserva"
        className="min-h-9 rounded-lg border border-border-strong bg-surface px-2 font-bold text-ink"
        defaultValue={months}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setEmergencyMonthsAction(Number(e.target.value));
            router.refresh();
          })
        }
      >
        {[3, 4, 6, 9, 12, 18, 24].map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      meses de gastos essenciais
    </label>
  );
}

/** Quanto rende: CDB/caixinha a X% do CDI (IR regressivo por aporte) × poupança × parado. */
export function YieldSimulator({
  cdiAnnual,
  selicAnnual,
  cdiDate,
}: {
  cdiAnnual: number | null;
  selicAnnual: number | null;
  cdiDate: string | null;
}) {
  const [f, setF] = useState({
    initial: '1000',
    monthly: '500',
    months: '24',
    cdiPct: '100',
    cdi: pctStr(cdiAnnual ?? 0.149),
    target: '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((cur) => ({ ...cur, [k]: e.target.value }));

  const r = useMemo(() => {
    const months = Math.min(600, Math.max(1, Math.round(num(f.months))));
    const base = {
      initialCents: Math.round(num(f.initial) * 100),
      months,
      cdiAnnual: num(f.cdi) / 100,
      cdiPct: num(f.cdiPct),
    };
    const monthlyCents = Math.round(num(f.monthly) * 100);
    const series = projectGrowth({ ...base, monthlyCents });
    const end = series.at(-1)!;
    const selic = selicAnnual ?? base.cdiAnnual + 0.001;
    const poup = projectTaxFree(
      base.initialCents,
      monthlyCents,
      months,
      savingsAccountAnnual(selic),
    );
    const target = Math.round(num(f.target) * 100);
    return {
      end,
      poup,
      months,
      needed: target > 0 ? requiredMonthly(target, base) : null,
    };
  }, [f, selicAnnual]);

  const yieldNet = r.end.netCents - r.end.investedCents;
  return (
    <Card className="flex flex-col gap-4">
      <CardTitle>Quanto rende</CardTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label="Valor inicial (R$)" htmlFor="sim-initial">
          <Input
            id="sim-initial"
            type="number"
            min="0"
            inputMode="decimal"
            value={f.initial}
            onChange={set('initial')}
          />
        </Field>
        <Field label="Aporte mensal (R$)" htmlFor="sim-monthly">
          <Input
            id="sim-monthly"
            type="number"
            min="0"
            inputMode="decimal"
            value={f.monthly}
            onChange={set('monthly')}
          />
        </Field>
        <Field label="Prazo (meses)" htmlFor="sim-months">
          <Input
            id="sim-months"
            type="number"
            min="1"
            max="600"
            value={f.months}
            onChange={set('months')}
          />
        </Field>
        <Field label="% do CDI" htmlFor="sim-pct">
          <Input
            id="sim-pct"
            type="number"
            min="0"
            max="300"
            inputMode="decimal"
            value={f.cdiPct}
            onChange={set('cdiPct')}
          />
        </Field>
        <Field
          label="CDI ao ano (%)"
          htmlFor="sim-cdi"
          hint={cdiAnnual != null && cdiDate ? `Banco Central em ${cdiDate}` : 'Informe o atual'}
        >
          <Input
            id="sim-cdi"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={f.cdi}
            onChange={set('cdi')}
          />
        </Field>
        <Field label="Quero chegar a (R$)" htmlFor="sim-target" hint="Opcional">
          <Input
            id="sim-target"
            type="number"
            min="0"
            inputMode="decimal"
            value={f.target}
            onChange={set('target')}
          />
        </Field>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="yield-result">
        <div className="rounded-xl bg-primary-soft p-3 text-primary-on-soft">
          <dt className="text-xs font-bold">Líquido em {r.months} meses</dt>
          <dd className="text-lg font-extrabold">
            <Money cents={r.end.netCents} />
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="text-xs font-bold text-ink-2">Você aportou</dt>
          <dd className="text-lg font-extrabold">
            <Money cents={r.end.investedCents} />
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="text-xs font-bold text-ink-2">Rendimento líquido</dt>
          <dd className="text-lg font-extrabold">
            <Money cents={yieldNet} />
          </dd>
          <dd className="text-xs text-ink-2">
            IR de <Money cents={r.end.irCents} /> já descontado
          </dd>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <dt className="text-xs font-bold text-ink-2">Na poupança</dt>
          <dd className="text-lg font-extrabold">
            <Money cents={r.poup} />
          </dd>
          <dd className="text-xs text-ink-2">
            {r.end.netCents >= r.poup ? 'CDB rende ' : 'Poupança rende '}
            <Money cents={Math.abs(r.end.netCents - r.poup)} /> a mais
          </dd>
        </div>
      </dl>
      {r.needed != null ? (
        <p className="text-sm" data-testid="yield-needed">
          Para chegar lá em {r.months} meses, guarde{' '}
          <Money cents={r.needed} className="font-extrabold" /> por mês.
        </p>
      ) : null}
      <p className="text-xs text-ink-2">
        IR regressivo calculado em cada aporte (22,5% até 6 meses, 15% depois de 2 anos), como num
        resgate total no fim. Poupança: 0,5% ao mês com a Selic acima de 8,5%, sem TR.
      </p>
    </Card>
  );
}
