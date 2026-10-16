'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { setupAction } from '../actions';

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Token de configuração" htmlFor="token" hint="Valor da variável SETUP_TOKEN.">
        <Input id="token" name="token" type="password" autoComplete="off" required />
      </Field>
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required />
      </Field>
      <Field label="Senha" htmlFor="password" hint="Pelo menos 12 caracteres, misturando tipos.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </Field>
      <Field label="Confirme a senha" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Criando…' : 'Criar acesso'}
      </Button>
    </form>
  );
}
