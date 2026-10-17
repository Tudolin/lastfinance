'use client';

import { Fingerprint, Plus, RefreshCw } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import {
  createConnectTokenAction,
  fakeConnectAction,
  registerItemAction,
  requestUpdateAction,
  syncNowAction,
} from './actions';

// O widget só existe no navegador.
const PluggyConnect = dynamic(() => import('react-pluggy-connect').then((m) => m.PluggyConnect), {
  ssr: false,
});

/** Conectar nova instituição ou reconectar (updateItem) uma existente. */
export function ConnectButton({
  reconnectItemId,
  fake,
}: {
  reconnectItemId?: string;
  fake: boolean;
}) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const open = () =>
    start(async () => {
      setError(undefined);
      const r = await createConnectTokenAction(reconnectItemId);
      if (!r.ok) {
        if (r.needStepUp) router.push(`/reauth?next=${encodeURIComponent('/contas')}`);
        else setError(r.error);
        return;
      }
      setToken(r.token ?? null);
    });

  const done = (itemId: string) =>
    start(async () => {
      setToken(null);
      const r = await registerItemAction(itemId);
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  if (fake && !reconnectItemId) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-2">
          Modo de demonstração (PLUGGY_FAKE): conecta uma instituição com dados sintéticos.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {(['nubank', 'itau'] as const).map((k) => (
            <Button
              key={k}
              variant="dashed"
              size="lg"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await fakeConnectAction(k);
                  if (!r.ok) setError(r.error);
                  router.refresh();
                })
              }
            >
              <Plus className="size-[18px]" aria-hidden="true" />
              {k === 'nubank' ? 'Nubank (demo)' : 'Itaú (demo)'}
            </Button>
          ))}
        </div>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {reconnectItemId ? (
        <Button variant="dark" size="lg" onClick={open} disabled={pending}>
          <Fingerprint className="size-[18px]" aria-hidden="true" />
          Reconectar (confirma com a digital)
        </Button>
      ) : (
        <Button variant="dashed" size="lg" onClick={open} disabled={pending}>
          <Plus className="size-[18px]" aria-hidden="true" />
          Conectar instituição
        </Button>
      )}
      <FormError message={error} />
      {token ? (
        <PluggyConnect
          connectToken={token}
          updateItem={reconnectItemId}
          onSuccess={({ item }) => done(item.id)}
          onError={(e) => {
            setError(`A conexão não foi concluída: ${e.message}`);
            if (e.data?.item?.id) done(e.data.item.id);
          }}
          onClose={() => setToken(null)}
        />
      ) : null}
    </div>
  );
}

export function SyncButtons({
  pluggyItemId,
  canRequestUpdate = true,
}: {
  pluggyItemId: string;
  canRequestUpdate?: boolean;
}) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string }>();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <div className={`grid gap-2 ${canRequestUpdate ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await syncNowAction(pluggyItemId);
              setMsg(
                r.ok
                  ? { tone: 'ok', text: 'Sincronização iniciada.' }
                  : { tone: 'err', text: r.error },
              );
              router.refresh();
            })
          }
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Sincronizar
        </Button>
        {canRequestUpdate ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await requestUpdateAction(pluggyItemId);
                setMsg(
                  r.ok
                    ? {
                        tone: 'ok',
                        text: 'Pedido enviado ao banco. Os dados chegam em alguns minutos.',
                      }
                    : { tone: 'err', text: r.error },
                );
              })
            }
          >
            Atualizar no banco
          </Button>
        ) : null}
      </div>
      {msg ? (
        <p
          className={`text-xs font-semibold ${msg.tone === 'ok' ? 'text-primary-on-soft' : 'text-danger-ink dark:text-danger'}`}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}
