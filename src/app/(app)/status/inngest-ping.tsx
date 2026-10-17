'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { pingInngestAction, type PingResult } from './actions';

export function InngestPing() {
  const [result, setResult] = useState<PingResult>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        disabled={pending}
        onClick={() => start(async () => setResult(await pingInngestAction()))}
      >
        Testar envio ao Inngest
      </Button>
      {result ? (
        <p
          className={`text-xs font-semibold ${result.ok ? 'text-primary-on-soft' : 'text-danger-ink dark:text-danger'}`}
        >
          {result.ok ? `Evento aceito pelo Inngest (${result.id ?? 'sem id'}).` : result.error}
        </p>
      ) : null}
      {result?.probes.length ? (
        <ul className="font-mono text-xs text-ink-2">
          {result.probes.map((p) => (
            <li key={p.envHeader ?? 'none'}>
              {p.envHeader ? `com x-inngest-env: ${p.envHeader}` : 'sem x-inngest-env'} → HTTP{' '}
              {p.status ?? '—'}
              {p.error ? ` (${p.error})` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
