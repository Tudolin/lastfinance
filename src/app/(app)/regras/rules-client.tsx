'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import {
  applyRuleAction,
  createRuleAction,
  deleteRuleAction,
  toggleRuleAction,
} from '@/app/(app)/categorias/actions';
import { FormError } from '@/components/auth/form-error';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { TX_KINDS, TX_KIND_LABEL } from '@/domain/classification/types';

const sel =
  'min-h-12 rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold';

export function NewRuleForm({
  categories,
  accounts,
}: {
  categories: CategoryOption[];
  accounts: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(createRuleAction, undefined);
  const [applying, start] = useTransition();
  const [applied, setApplied] = useState<number | null>(null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome da regra" htmlFor="r-name">
        <Input id="r-name" name="name" required placeholder="Ex.: Uber é transporte" />
      </Field>
      <Field
        label="Se a descrição contém (separe por vírgula)"
        htmlFor="r-terms"
        hint="Sem diferenciar acentos e maiúsculas."
      >
        <Input id="r-terms" name="terms" placeholder="uber, 99 pop" />
      </Field>
      <details className="text-sm">
        <summary className="cursor-pointer font-bold text-ink-2">Condições avançadas</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Expressão regular" htmlFor="r-regex">
            <Input id="r-regex" name="regex" placeholder="^IFD\*" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Conta" htmlFor="r-account">
              <select id="r-account" name="accountId" className={sel}>
                <option value="">Qualquer</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Direção" htmlFor="r-direction">
              <select id="r-direction" name="direction" className={sel}>
                <option value="">Qualquer</option>
                <option value="out">Saída</option>
                <option value="in">Entrada</option>
              </select>
            </Field>
          </div>
          <Field label="Prioridade (menor vem antes)" htmlFor="r-priority">
            <Input
              id="r-priority"
              name="priority"
              type="number"
              min={0}
              max={1000}
              defaultValue={100}
            />
          </Field>
        </div>
      </details>
      <Field label="Então: categoria" htmlFor="r-category">
        <CategorySelect
          id="r-category"
          name="categoryId"
          categories={categories}
          emptyLabel="(não mudar)"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo" htmlFor="r-kind">
          <select id="r-kind" name="kind" className={sel}>
            <option value="">(não mudar)</option>
            {TX_KINDS.map((k) => (
              <option key={k} value={k}>
                {TX_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags" htmlFor="r-tags">
          <Input id="r-tags" name="tags" placeholder="#trabalho" />
        </Field>
      </div>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok && state.data ? (
        <Notice tone="success" className="flex flex-col items-start gap-2">
          <span>
            Regra criada. Ela vale para as próximas transações. {state.data.preview} transações
            antigas também combinam.
          </span>
          {state.data.preview > 0 && applied === null ? (
            <Button
              size="sm"
              disabled={applying}
              onClick={() =>
                start(async () => {
                  const r = await applyRuleAction(state.data!.id);
                  setApplied(r.ok ? (r.data?.applied ?? 0) : 0);
                  router.refresh();
                })
              }
            >
              Aplicar às {state.data.preview} antigas
            </Button>
          ) : null}
          {applied !== null ? (
            <span>Aplicada a {applied} transações (as que você categorizou à mão não mudam).</span>
          ) : null}
        </Notice>
      ) : null}
      <Button type="submit" disabled={pending}>
        Criar regra
      </Button>
    </form>
  );
}

export function RuleActions({ id, enabled }: { id: string; enabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [applied, setApplied] = useState<number | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-1">
      <label className="flex items-center gap-1.5 text-xs font-bold">
        <input
          type="checkbox"
          checked={enabled}
          disabled={pending}
          onChange={(e) =>
            start(async () => (await toggleRuleAction(id, e.target.checked), router.refresh()))
          }
          className="size-4"
        />
        ativa
      </label>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await applyRuleAction(id);
            setApplied(r.ok ? (r.data?.applied ?? 0) : 0);
            router.refresh();
          })
        }
      >
        {applied === null ? 'Aplicar às antigas' : `Aplicada a ${applied}`}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Excluir regra"
        disabled={pending}
        onClick={() =>
          start(async () => {
            if (
              !confirm('Excluir esta regra? As transações já categorizadas continuam como estão.')
            )
              return;
            await deleteRuleAction(id);
            router.refresh();
          })
        }
      >
        <Trash2 className="size-4" aria-hidden="true" />
      </Button>
    </span>
  );
}
