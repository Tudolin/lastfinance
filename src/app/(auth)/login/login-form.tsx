'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { loginAction } from '../actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="E-mail" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username webauthn" required />
      </Field>
      <Field label="Senha" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <FormError message={state?.error} />
      <Button type="submit" variant="outline" size="lg" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar com senha'}
      </Button>
    </form>
  );
}
