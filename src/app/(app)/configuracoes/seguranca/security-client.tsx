'use client';

import { startRegistration } from '@simplewebauthn/browser';
import { Fingerprint, KeyRound, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import {
  changePasswordAction,
  deletePasskeyAction,
  passkeyRegisterOptionsAction,
  passkeyRegisterVerifyAction,
  recoveryCodesAction,
  totpConfirmAction,
  totpDisableAction,
  totpStartAction,
  updateLockSettingsAction,
  type ActionResult,
} from '../actions';

const REAUTH = `/reauth?next=${encodeURIComponent('/configuracoes/seguranca')}`;

function useStepUpAware() {
  const router = useRouter();
  return (r: ActionResult) => {
    if (!r.ok && r.needStepUp) {
      router.push(REAUTH);
      return true;
    }
    return false;
  };
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad/i.test(ua)) return 'iPhone/iPad';
  if (/Windows/i.test(ua)) return 'Windows Hello';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Dispositivo';
}

export function AddPasskey({ highlight }: { highlight: boolean }) {
  const router = useRouter();
  const handleStepUp = useStepUpAware();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const add = () =>
    start(async () => {
      setError(undefined);
      const opt = await passkeyRegisterOptionsAction();
      if (handleStepUp(opt)) return;
      if (!opt.ok || !opt.data) return setError(opt.ok ? 'Erro' : opt.error);
      try {
        const response = await startRegistration({ optionsJSON: opt.data.options });
        const r = await passkeyRegisterVerifyAction(
          opt.data.challengeId,
          response,
          guessDeviceName(),
        );
        if (handleStepUp(r)) return;
        if (!r.ok) return setError(r.error);
        router.refresh();
      } catch (e) {
        if ((e as Error).name === 'InvalidStateError')
          setError('Este dispositivo já tem uma passkey cadastrada.');
        else if ((e as Error).name !== 'NotAllowedError')
          setError('O dispositivo não conseguiu criar a passkey.');
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={highlight ? 'primary' : 'outline'}
        size="lg"
        onClick={add}
        disabled={pending}
      >
        <Fingerprint className="size-5" aria-hidden="true" />
        {pending ? 'Aguardando o dispositivo…' : 'Ativar entrada com digital neste dispositivo'}
      </Button>
      <FormError message={error} />
    </div>
  );
}

export function DeletePasskeyButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const handleStepUp = useStepUpAware();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remover passkey ${name}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          if (!confirm(`Remover a passkey "${name}"?`)) return;
          const r = await deletePasskeyAction(id);
          if (!handleStepUp(r)) router.refresh();
        })
      }
    >
      <Trash2 className="size-4" aria-hidden="true" />
    </Button>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warn-border bg-warn-soft p-4 text-warn-ink">
      <strong>Guarde estes códigos agora — eles não serão mostrados de novo.</strong>
      <span className="text-sm">
        Cada código funciona uma vez, no lugar do autenticador, se você perder o celular.
      </span>
      <ul className="grid grid-cols-2 gap-1.5 font-mono text-[15px] font-bold">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  );
}

export function TotpSection({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const handleStepUp = useStepUpAware();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  if (codes) return <RecoveryCodes codes={codes} />;

  if (enabled) {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await recoveryCodesAction();
              if (handleStepUp(r)) return;
              if (r.ok && r.data) setCodes(r.data.codes);
            })
          }
        >
          Gerar novos códigos de recuperação
        </Button>
        <Button
          variant="danger"
          disabled={pending}
          onClick={() =>
            start(async () => {
              if (!confirm('Desativar a verificação em duas etapas?')) return;
              const r = await totpDisableAction();
              if (!handleStepUp(r)) router.refresh();
            })
          }
        >
          Desativar 2FA
        </Button>
      </div>
    );
  }

  if (!setup) {
    return (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await totpStartAction();
            if (handleStepUp(r)) return;
            if (r.ok && r.data) setSetup(r.data);
          })
        }
      >
        <KeyRound className="size-4" aria-hidden="true" />
        Ativar verificação em duas etapas (TOTP)
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      action={(fd) =>
        start(async () => {
          setError(undefined);
          const r = await totpConfirmAction(setup.secret, String(fd.get('code') ?? ''));
          if (handleStepUp(r)) return;
          if (!r.ok) return setError(r.error);
          setCodes(r.data?.codes ?? []);
          router.refresh();
        })
      }
    >
      <p className="text-sm text-ink-2">
        Escaneie com o Google Authenticator, 1Password, Authy etc. e digite o código gerado.
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={setup.qr}
        alt="QR code para o app autenticador"
        width={220}
        height={220}
        className="rounded-lg bg-white p-2"
      />
      <code className="text-xs break-all text-ink-2">{setup.secret}</code>
      <Field label="Código de 6 dígitos" htmlFor="totp-code">
        <Input
          id="totp-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
        />
      </Field>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        Confirmar e ativar
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const handleStepUp = useStepUpAware();
  const [state, action, pending] = useActionState(
    async (prev: ActionResult | undefined, fd: FormData) => {
      const r = await changePasswordAction(prev, fd);
      handleStepUp(r);
      return r;
    },
    undefined,
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label="Senha atual" htmlFor="current">
        <Input
          id="current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="Nova senha" htmlFor="next">
        <Input
          id="next"
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </Field>
      <Field label="Confirme a nova senha" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </Field>
      {state && !state.ok && !state.needStepUp ? <FormError message={state.error} /> : null}
      {state?.ok ? (
        <Notice tone="success">Senha alterada. As outras sessões foram encerradas.</Notice>
      ) : null}
      <Button type="submit" variant="outline" disabled={pending}>
        Trocar senha
      </Button>
    </form>
  );
}

export function LockSettingsForm({
  lockTimeoutMinutes,
  relockAfterBackgroundSeconds,
}: {
  lockTimeoutMinutes: number;
  relockAfterBackgroundSeconds: number;
}) {
  const [state, action, pending] = useActionState(updateLockSettingsAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bloquear após (min sem uso)" htmlFor="lockTimeoutMinutes">
          <Input
            id="lockTimeoutMinutes"
            name="lockTimeoutMinutes"
            type="number"
            min={1}
            max={240}
            defaultValue={lockTimeoutMinutes}
          />
        </Field>
        <Field label="Ao voltar do segundo plano após (s)" htmlFor="relockAfterBackgroundSeconds">
          <Input
            id="relockAfterBackgroundSeconds"
            name="relockAfterBackgroundSeconds"
            type="number"
            min={0}
            max={3600}
            defaultValue={relockAfterBackgroundSeconds}
          />
        </Field>
      </div>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <Notice tone="success">Salvo.</Notice> : null}
      <Button type="submit" variant="outline" disabled={pending}>
        Salvar
      </Button>
    </form>
  );
}
