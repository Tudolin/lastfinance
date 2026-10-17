'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  checkNowAction,
  markAllReadAction,
  subscribePushAction,
  testPushAction,
  unsubscribePushAction,
  updateAlertPrefsAction,
  type Result,
} from './actions';

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = 'loading' | 'unsupported' | 'denied' | 'off' | 'on';

async function detectState(publicKey: string | null): Promise<State> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !publicKey)
    return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

/** Liga/desliga as notificações neste aparelho (Web Push pelo service worker). */
export function PushToggle({ publicKey }: { publicKey: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<State>('loading');
  const [msg, setMsg] = useState<Result | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    detectState(publicKey).then(setState);
  }, [publicKey]);

  const enable = () =>
    start(async () => {
      setMsg(null);
      try {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') {
          setState(perm === 'denied' ? 'denied' : 'off');
          return;
        }
        const reg =
          (await navigator.serviceWorker.getRegistration('/')) ??
          (await navigator.serviceWorker.register('/sw.js', { scope: '/' }));
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: b64ToBytes(publicKey!),
        });
        const r = await subscribePushAction(sub.toJSON());
        setMsg(r);
        if (r.ok) {
          setState('on');
          router.refresh();
        }
      } catch {
        setMsg({ ok: false, error: 'Não foi possível ativar neste navegador.' });
      }
    });

  const disable = () =>
    start(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribePushAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState('off');
      router.refresh();
    });

  const test = () => start(async () => setMsg(await testPushAction()));

  return (
    <div className="flex flex-col gap-2">
      {state === 'unsupported' ? (
        <Notice>
          Este navegador não recebe notificações. No celular, instale o app na tela inicial (no
          iPhone, pelo Safari: Compartilhar → Adicionar à Tela de Início) e abra por lá.
        </Notice>
      ) : state === 'denied' ? (
        <Notice tone="warn">
          As notificações estão bloqueadas para este site. Libere nas configurações do navegador e
          volte aqui.
        </Notice>
      ) : (
        <div className="flex flex-wrap gap-2">
          {state === 'on' ? (
            <>
              <Button variant="outline" onClick={test} disabled={pending}>
                Enviar teste
              </Button>
              <Button variant="ghost" onClick={disable} disabled={pending}>
                Desativar neste aparelho
              </Button>
            </>
          ) : (
            <Button onClick={enable} disabled={pending || state === 'loading'}>
              Ativar notificações neste aparelho
            </Button>
          )}
        </div>
      )}
      {msg ? (
        msg.ok ? (
          msg.message ? (
            <Notice tone="success">{msg.message}</Notice>
          ) : null
        ) : (
          <FormError message={msg.error} />
        )
      ) : null}
    </div>
  );
}

export function InboxButtons({ unread }: { unread: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await checkNowAction();
            setMsg(r.ok ? (r.message ?? null) : r.error);
            router.refresh();
          })
        }
      >
        Verificar agora
      </Button>
      {unread ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await markAllReadAction();
              router.refresh();
            })
          }
        >
          Marcar todos como lidos
        </Button>
      ) : null}
      {msg ? (
        <span className="text-sm text-ink-2" role="status">
          {msg}
        </span>
      ) : null}
    </div>
  );
}

export function AlertPrefsForm({
  types,
  off,
  largeExpense,
  quietStart,
  quietEnd,
}: {
  types: Record<string, string>;
  off: string[];
  largeExpense: number;
  quietStart: number;
  quietEnd: number;
}) {
  const [state, action, pending] = useActionState(updateAlertPrefsAction, undefined);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const selectCls =
    'min-h-12 w-full rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink';
  return (
    <form action={action} className="flex flex-col gap-3" aria-label="Preferências de alertas">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-bold text-ink-2">Avisar sobre</legend>
        {Object.entries(types).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="types"
              value={k}
              defaultChecked={!off.includes(k)}
              className="size-4"
            />
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Gasto grande a partir de (R$)" htmlFor="al-large">
        <Input
          id="al-large"
          name="largeExpense"
          type="number"
          min="0"
          step="1"
          inputMode="decimal"
          defaultValue={largeExpense / 100}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Silêncio a partir de" htmlFor="al-qs">
          <select id="al-qs" name="quietStart" defaultValue={quietStart} className={selectCls}>
            {hours.map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </Field>
        <Field label="até" htmlFor="al-qe">
          <select id="al-qe" name="quietEnd" defaultValue={quietEnd} className={selectCls}>
            {hours.map((h) => (
              <option key={h} value={h}>
                {h}h
              </option>
            ))}
          </select>
        </Field>
      </div>
      <p className="text-xs text-ink-2">
        No silêncio os alertas ficam guardados e chegam quando ele termina.
      </p>
      {state ? (
        state.ok ? (
          <Notice tone="success">{state.message}</Notice>
        ) : (
          <FormError message={state.error} />
        )
      ) : null}
      <Button type="submit" disabled={pending}>
        Salvar preferências
      </Button>
    </form>
  );
}
