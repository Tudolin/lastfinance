'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { useState, useTransition } from 'react';
import { passkeyLoginAction, passkeyLoginOptionsAction } from '@/app/(auth)/actions';
import { Button } from '@/components/ui/button';
import { FormError } from './form-error';

export function PasskeyLoginButton() {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      setError(undefined);
      try {
        const { challengeId, options } = await passkeyLoginOptionsAction();
        const response = await startAuthentication({ optionsJSON: options });
        const r = await passkeyLoginAction(challengeId, response);
        if (r?.error) setError(r.error);
      } catch (e) {
        if ((e as Error).name !== 'NotAllowedError')
          setError('Não foi possível usar a passkey neste dispositivo.');
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <Button variant="dark" size="lg" onClick={run} disabled={pending}>
        <Fingerprint className="size-5" aria-hidden="true" />
        {pending ? 'Aguardando…' : 'Entrar com digital (passkey)'}
      </Button>
      <FormError message={error} />
    </div>
  );
}
