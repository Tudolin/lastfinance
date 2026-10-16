'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import {
  deleteRecurringAction,
  saveRecurringAction,
  setRecurringStatusAction,
} from '../previsao/actions';

const selectCls =
  'min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink';

export type RecurringDefaults = {
  id?: string;
  name?: string;
  direction?: 'in' | 'out';
  amountCents?: number;
  anchorDay?: number;
  periodicity?: 'weekly' | 'monthly' | 'yearly';
  anchorMonth?: number | null;
  nature?: 'fixed' | 'variable';
  accountId?: string | null;
  categoryId?: string | null;
  matchPattern?: string | null;
  endDate?: string | null;
};

export function RecurringForm({
  defaults = {},
  accounts,
  categories,
  submitLabel,
}: {
  defaults?: RecurringDefaults;
  accounts: { id: string; name: string }[];
  categories: CategoryOption[];
  submitLabel: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(saveRecurringAction, undefined);
  const [per, setPer] = useState(defaults.periodicity ?? 'monthly');
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const p = defaults.id ?? 'new-rec';
  return (
    <form
      action={action}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      aria-label={submitLabel}
    >
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <Field label="Nome" htmlFor={`${p}-name`}>
        <Input id={`${p}-name`} name="name" defaultValue={defaults.name} required />
      </Field>
      <Field label="Valor (R$)" htmlFor={`${p}-amount`}>
        <Input
          id={`${p}-amount`}
          name="amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          defaultValue={defaults.amountCents != null ? (defaults.amountCents / 100).toFixed(2) : ''}
          required
        />
      </Field>
      <Field label="Sentido" htmlFor={`${p}-dir`}>
        <select
          id={`${p}-dir`}
          name="direction"
          className={selectCls}
          defaultValue={defaults.direction ?? 'out'}
        >
          <option value="out">Saída</option>
          <option value="in">Entrada</option>
        </select>
      </Field>
      <Field label="Periodicidade" htmlFor={`${p}-per`}>
        <select
          id={`${p}-per`}
          name="periodicity"
          className={selectCls}
          value={per}
          onChange={(e) => setPer(e.target.value as typeof per)}
        >
          <option value="monthly">Mensal</option>
          <option value="weekly">Semanal</option>
          <option value="yearly">Anual</option>
        </select>
      </Field>
      {per === 'weekly' ? (
        <Field label="Dia da semana" htmlFor={`${p}-day`}>
          <select
            id={`${p}-day`}
            name="anchorDay"
            className={selectCls}
            defaultValue={String(defaults.anchorDay ?? 1)}
          >
            {['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'].map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Dia do mês" htmlFor={`${p}-day`}>
          <Input
            id={`${p}-day`}
            name="anchorDay"
            type="number"
            min="1"
            max="31"
            defaultValue={defaults.anchorDay ?? 10}
            required
          />
        </Field>
      )}
      {per === 'yearly' ? (
        <Field label="Mês" htmlFor={`${p}-month`}>
          <Input
            id={`${p}-month`}
            name="anchorMonth"
            type="number"
            min="1"
            max="12"
            defaultValue={defaults.anchorMonth ?? 1}
          />
        </Field>
      ) : null}
      <Field label="Valor" htmlFor={`${p}-nature`}>
        <select
          id={`${p}-nature`}
          name="nature"
          className={selectCls}
          defaultValue={defaults.nature ?? 'fixed'}
        >
          <option value="fixed">Fixo</option>
          <option value="variable">Variável (conta de luz, água…)</option>
        </select>
      </Field>
      <Field label="Conta ou cartão" htmlFor={`${p}-acc`}>
        <select
          id={`${p}-acc`}
          name="accountId"
          className={selectCls}
          defaultValue={defaults.accountId ?? ''}
        >
          <option value="">Qualquer</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Categoria" htmlFor={`${p}-cat`}>
        <CategorySelect
          id={`${p}-cat`}
          name="categoryId"
          categories={categories}
          defaultValue={defaults.categoryId ?? ''}
        />
      </Field>
      <Field label="Texto no extrato" htmlFor={`${p}-pat`} hint="Para reconhecer a cobrança real.">
        <Input id={`${p}-pat`} name="matchPattern" defaultValue={defaults.matchPattern ?? ''} />
      </Field>
      <Field label="Termina em (opcional)" htmlFor={`${p}-end`}>
        <Input id={`${p}-end`} name="endDate" type="date" defaultValue={defaults.endDate ?? ''} />
      </Field>
      {state && !state.ok ? (
        <div className="sm:col-span-2">
          <FormError message={state.error} />
        </div>
      ) : null}
      <Button type="submit" disabled={pending} className="sm:col-span-2">
        {submitLabel}
      </Button>
    </form>
  );
}

export function RecurringStatusButtons({
  id,
  status,
  name,
}: {
  id: string;
  status: string;
  name: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<unknown>) => start(async () => (await fn(), router.refresh()));
  return (
    <div className="flex gap-2">
      {status !== 'confirmed' ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() => go(() => setRecurringStatusAction(id, 'confirmed'))}
          aria-label={`Confirmar ${name}`}
        >
          Confirmar
        </Button>
      ) : null}
      {status === 'suggested' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => go(() => setRecurringStatusAction(id, 'ignored'))}
          aria-label={`Ignorar ${name}`}
        >
          Ignorar
        </Button>
      ) : null}
      {status === 'confirmed' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => go(() => deleteRecurringAction(id))}
          aria-label={`Remover ${name}`}
        >
          Remover
        </Button>
      ) : null}
    </div>
  );
}
