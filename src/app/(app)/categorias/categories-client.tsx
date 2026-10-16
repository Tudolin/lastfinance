'use client';

import { Archive, ArchiveRestore, Check, Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  archiveCategoryAction,
  createCategoryAction,
  renameCategoryAction,
  resolveSuggestionAction,
} from './actions';

export function NewCategoryForm({
  parents,
}: {
  parents: { id: string; name: string; kind: 'expense' | 'income' }[];
}) {
  const [state, action, pending] = useActionState(createCategoryAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Nome" htmlFor="cat-name">
        <Input id="cat-name" name="name" required minLength={2} maxLength={60} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo" htmlFor="cat-kind">
          <select
            id="cat-kind"
            name="kind"
            className="min-h-12 rounded-xl border border-border-strong bg-surface px-3 font-semibold"
          >
            <option value="expense">Despesa</option>
            <option value="income">Receita</option>
          </select>
        </Field>
        <Field label="Dentro de" htmlFor="cat-parent">
          <select
            id="cat-parent"
            name="parentId"
            className="min-h-12 rounded-xl border border-border-strong bg-surface px-3 font-semibold"
          >
            <option value="">(categoria principal)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <Notice tone="success">Categoria criada.</Notice> : null}
      <Button type="submit" disabled={pending}>
        Criar categoria
      </Button>
    </form>
  );
}

export function CategoryRowActions({
  id,
  name,
  archived,
}: {
  id: string;
  name: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [pending, start] = useTransition();
  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          aria-label="Novo nome"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm"
        />
        <Button
          size="icon"
          variant="ghost"
          aria-label="Salvar nome"
          disabled={pending}
          onClick={() =>
            start(
              async () => (
                await renameCategoryAction(id, value),
                setEditing(false),
                router.refresh()
              ),
            )
          }
        >
          <Check className="size-4" aria-hidden="true" />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Cancelar" onClick={() => setEditing(false)}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center">
      <Button
        size="icon"
        variant="ghost"
        aria-label={`Renomear ${name}`}
        onClick={() => setEditing(true)}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label={archived ? `Restaurar ${name}` : `Arquivar ${name}`}
        disabled={pending}
        onClick={() =>
          start(async () => (await archiveCategoryAction(id, !archived), router.refresh()))
        }
      >
        {archived ? (
          <ArchiveRestore className="size-4" aria-hidden="true" />
        ) : (
          <Archive className="size-4" aria-hidden="true" />
        )}
      </Button>
    </span>
  );
}

export function SuggestionActions({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="flex gap-2">
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => (await resolveSuggestionAction(id, true), router.refresh()))
        }
      >
        Criar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          start(async () => (await resolveSuggestionAction(id, false), router.refresh()))
        }
      >
        Dispensar
      </Button>
    </span>
  );
}
