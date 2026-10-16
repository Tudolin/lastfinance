'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { importItemAction } from './actions';

export function ImportItemForm() {
  const [state, action, pending] = useActionState(importItemAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field
        label="ID do item na Pluggy"
        htmlFor="itemId"
        hint="Dashboard da Pluggy → sua aplicação → Items. Útil para os itens que você já conectou antes do app existir."
      >
        <Input
          id="itemId"
          name="itemId"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="ex.: 3f2a9c1e-…"
        />
      </Field>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <Notice tone="success">Importado. A carga histórica começou.</Notice> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Importando…' : 'Importar'}
      </Button>
    </form>
  );
}
