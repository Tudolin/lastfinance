'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import {
  createPlannedAction,
  deletePlannedAction,
  setPlannedStatusAction,
} from '../previsao/actions';

const selectCls =
  'min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink';

export function PaymentFields({
  accounts,
  prefix,
  method,
  setMethod,
}: {
  accounts: { id: string; name: string; kind: string }[];
  prefix: string;
  method: 'pix' | 'debit' | 'credit';
  setMethod: (m: 'pix' | 'debit' | 'credit') => void;
}) {
  const options = accounts.filter((a) =>
    method === 'credit' ? a.kind === 'credit_card' : a.kind !== 'credit_card',
  );
  return (
    <>
      <Field label="Forma de pagamento" htmlFor={`${prefix}-method`}>
        <select
          id={`${prefix}-method`}
          name={prefix === 'sim' ? 'method' : 'paymentMethod'}
          className={selectCls}
          value={method}
          onChange={(e) => setMethod(e.target.value as typeof method)}
        >
          <option value="pix">Pix</option>
          <option value="debit">Débito</option>
          <option value="credit">Crédito</option>
        </select>
      </Field>
      <Field label={method === 'credit' ? 'Cartão' : 'Conta'} htmlFor={`${prefix}-acc`}>
        <select
          key={method}
          id={`${prefix}-acc`}
          name="accountId"
          className={selectCls}
          defaultValue={options[0]?.id ?? ''}
        >
          {method !== 'credit' ? <option value="">Qualquer conta</option> : null}
          {options.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      {method === 'credit' ? (
        <Field label="Parcelas" htmlFor={`${prefix}-inst`}>
          <Input
            id={`${prefix}-inst`}
            name="installments"
            type="number"
            min="1"
            max="48"
            defaultValue={1}
          />
        </Field>
      ) : null}
    </>
  );
}

export function PlannedForm({
  accounts,
  categories,
  today,
}: {
  accounts: { id: string; name: string; kind: string }[];
  categories: CategoryOption[];
  today: string;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createPlannedAction, undefined);
  const [method, setMethod] = useState<'pix' | 'debit' | 'credit'>('pix');
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Planejar gasto">
      <Field label="Descrição" htmlFor="pl-desc">
        <Input id="pl-desc" name="description" required placeholder="Ex.: IPVA" />
      </Field>
      <Field label="Valor total (R$)" htmlFor="pl-amount">
        <Input
          id="pl-amount"
          name="amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          required
        />
      </Field>
      <Field label="Data" htmlFor="pl-date">
        <Input id="pl-date" name="date" type="date" defaultValue={today} required />
      </Field>
      <PaymentFields accounts={accounts} prefix="pl" method={method} setMethod={setMethod} />
      <Field label="Categoria" htmlFor="pl-cat">
        <CategorySelect id="pl-cat" name="categoryId" categories={categories} kind="expense" />
      </Field>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      <Button type="submit" disabled={pending}>
        Planejar
      </Button>
    </form>
  );
}

export function PlannedStatusButtons({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (fn: () => Promise<unknown>) => start(async () => (await fn(), router.refresh()));
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => go(() => setPlannedStatusAction(id, 'done'))}
        aria-label={`Concluir ${name}`}
      >
        Concluído
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => go(() => setPlannedStatusAction(id, 'cancelled'))}
        aria-label={`Cancelar ${name}`}
      >
        Cancelar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => go(() => deletePlannedAction(id))}
        aria-label={`Apagar ${name}`}
      >
        Apagar
      </Button>
    </div>
  );
}
