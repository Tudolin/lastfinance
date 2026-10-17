'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { registerPluggyWebhookAction, type WebhookResult } from './actions';

export function WebhookRegister({ registered }: { registered: boolean }) {
  const [result, setResult] = useState<WebhookResult>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={registered ? 'outline' : 'primary'}
        disabled={pending}
        onClick={() => start(async () => setResult(await registerPluggyWebhookAction()))}
      >
        {registered ? 'Registrar de novo' : 'Registrar webhook'}
      </Button>
      {result ? (
        <p
          className={`text-xs font-semibold ${result.ok ? 'text-primary-on-soft' : 'text-danger-ink dark:text-danger'}`}
        >
          {result.ok
            ? `Pronto: a Pluggy vai avisar ${result.status.expectedUrl} a cada atualização.`
            : result.error}
        </p>
      ) : null}
    </div>
  );
}
