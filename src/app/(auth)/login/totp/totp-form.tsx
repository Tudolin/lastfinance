'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { totpLoginAction } from '../../actions';

export function TotpForm() {
  const [state, action, pending] = useActionState(totpLoginAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Código do autenticador"
        htmlFor="code"
        hint="Perdeu o celular? Use um código de recuperação (XXXXX-XXXXX)."
      >
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          className="text-xl tracking-widest"
        />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Verificando…' : 'Confirmar'}
      </Button>
    </form>
  );
}
