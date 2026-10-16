'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { Fingerprint } from 'lucide-react';
import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import {
  logoutAction,
  unlockOptionsAction,
  unlockPasskeyAction,
  unlockPasswordAction,
} from '@/app/(auth)/actions';
import { BrandMark } from '@/components/brand';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { FormError } from './form-error';

/**
 * Tela de bloqueio (sempre no tema escuro, como no design aprovado).
 * Com passkey cadastrada, já abre o prompt da digital; a senha fica como alternativa.
 */
export function UnlockPanel({
  title,
  subtitle,
  next,
  hasPasskey,
}: {
  title: string;
  subtitle: string;
  next: string;
  hasPasskey: boolean;
}) {
  const [showPassword, setShowPassword] = useState(!hasPasskey);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const [pwState, pwAction, pwPending] = useActionState(unlockPasswordAction, undefined);
  const autoTried = useRef(false);

  const unlockWithPasskey = () =>
    start(async () => {
      setError(undefined);
      try {
        const { challengeId, options } = await unlockOptionsAction();
        const response = await startAuthentication({ optionsJSON: options });
        const r = await unlockPasskeyAction(challengeId, response, next);
        if (r?.error) setError(r.error);
      } catch (e) {
        if ((e as Error).name !== 'NotAllowedError')
          setError('Não foi possível usar a digital agora.');
      }
    });

  useEffect(() => {
    if (hasPasskey && !autoTried.current && document.visibilityState === 'visible') {
      autoTried.current = true;
      unlockWithPasskey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPasskey]);

  return (
    <div className="dark fixed inset-0 flex flex-col items-center bg-[#0e1512] px-6 pt-24 pb-12 text-[#e8eeea]">
      <div className="flex items-center gap-2.5">
        <BrandMark size={36} />
        <span className="text-xl font-extrabold tracking-tight">lastfinance</span>
      </div>
      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-7 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <p className="text-[15px] leading-relaxed text-[#a9b5ae]">{subtitle}</p>
        </div>
        {hasPasskey ? (
          <>
            <button
              type="button"
              onClick={unlockWithPasskey}
              disabled={pending}
              aria-label="Desbloquear com a digital"
              className="flex size-28 items-center justify-center rounded-full border-2 border-[#2e7d64] bg-[#16201b] text-[#7fd8b5] disabled:opacity-60"
            >
              <Fingerprint className="size-14" strokeWidth={1.6} aria-hidden="true" />
            </button>
            <span className="text-[15px] font-bold">
              {pending ? 'Aguardando a digital…' : 'Toque para usar a digital'}
            </span>
          </>
        ) : null}
        <FormError message={error} />
        {showPassword ? (
          <form action={pwAction} className="flex w-full flex-col gap-3 text-left">
            <input type="hidden" name="next" value={next} />
            <Label htmlFor="unlock-password" className="text-[#a9b5ae]">
              Senha
            </Label>
            <Input
              id="unlock-password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus={!hasPasskey}
            />
            <FormError message={pwState?.error} />
            <Button type="submit" size="lg" disabled={pwPending}>
              {pwPending ? 'Verificando…' : 'Desbloquear'}
            </Button>
          </form>
        ) : null}
      </div>
      <div className="flex flex-col items-center gap-1">
        {hasPasskey && !showPassword ? (
          <button
            type="button"
            onClick={() => setShowPassword(true)}
            className="min-h-11 text-[15px] font-bold text-[#7fd8b5]"
          >
            Entrar com senha
          </button>
        ) : null}
        <form action={logoutAction}>
          <button type="submit" className="min-h-11 text-sm font-semibold text-[#a9b5ae]">
            Sair desta conta
          </button>
        </form>
      </div>
    </div>
  );
}
