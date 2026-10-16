'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import {
  copyBudgetsAction,
  deleteBudgetAction,
  upsertBudgetAction,
} from '@/app/(app)/categorias/actions';
import { FormError } from '@/components/auth/form-error';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

export function BudgetForm({ month, categories }: { month: string; categories: CategoryOption[] }) {
  const [state, action, pending] = useActionState(upsertBudgetAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="month" value={month} />
      <Field label="Categoria" htmlFor="b-cat">
        <CategorySelect
          id="b-cat"
          name="categoryId"
          categories={categories}
          kind="expense"
          emptyLabel="Escolha…"
          required
        />
      </Field>
      <Field label="Limite no mês (R$)" htmlFor="b-amount">
        <Input
          id="b-amount"
          name="amount"
          type="number"
          min="1"
          step="0.01"
          inputMode="decimal"
          required
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="rollover" className="size-4" />
        Levar a sobra para o mês seguinte
      </label>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      <Button type="submit" disabled={pending}>
        Salvar orçamento
      </Button>
    </form>
  );
}

export function CopyBudgetsButton({ month }: { month: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string>();
  return (
    <span className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await copyBudgetsAction(month);
            setMsg(r.ok ? `${r.data?.copied ?? 0} copiados` : 'Erro');
            router.refresh();
          })
        }
      >
        Copiar do mês anterior
      </Button>
      {msg ? <span className="text-xs text-ink-2">{msg}</span> : null}
    </span>
  );
}

export function DeleteBudgetButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon"
      variant="ghost"
      aria-label={`Remover orçamento de ${label}`}
      disabled={pending}
      onClick={() => start(async () => (await deleteBudgetAction(id), router.refresh()))}
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </Button>
  );
}
