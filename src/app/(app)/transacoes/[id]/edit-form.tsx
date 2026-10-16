'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { TX_KINDS, TX_KIND_LABEL, type TxKind } from '@/domain/classification/types';
import { updateTransactionAction } from '../actions';

export function EditTransactionForm(props: {
  id: string;
  description: string;
  notes: string;
  tags: string[];
  userKind: TxKind | null;
  autoKindLabel: string;
}) {
  const [state, action, pending] = useActionState(updateTransactionAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={props.id} />
      <Field label="Descrição" htmlFor="description">
        <Input
          id="description"
          name="description"
          defaultValue={props.description}
          maxLength={200}
        />
      </Field>
      <Field
        label="Tipo"
        htmlFor="kind"
        hint="Transferências entre suas contas, pagamento de fatura e aplicações não contam como despesa."
      >
        <select
          id="kind"
          name="kind"
          defaultValue={props.userKind ?? 'auto'}
          className="min-h-12 rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold"
        >
          <option value="auto">Automático ({props.autoKindLabel})</option>
          {TX_KINDS.map((k) => (
            <option key={k} value={k}>
              {TX_KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Tags" htmlFor="tags" hint="Separe por espaço. Ex.: #viagem-2026">
        <Input id="tags" name="tags" defaultValue={props.tags.map((t) => `#${t}`).join(' ')} />
      </Field>
      <Field label="Notas" htmlFor="notes">
        <textarea
          id="notes"
          name="notes"
          defaultValue={props.notes}
          rows={3}
          maxLength={2000}
          className="rounded-xl border border-border-strong bg-surface p-3 text-[15px]"
        />
      </Field>
      <FormError message={state?.error} />
      {state?.ok ? <Notice tone="success">Salvo.</Notice> : null}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Salvando…' : 'Salvar'}
      </Button>
    </form>
  );
}
