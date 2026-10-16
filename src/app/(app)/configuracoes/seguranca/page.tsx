import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import { dateTimeBR } from '@/lib/format';
import { requireUnlocked } from '@/server/auth/request';
import { listPasskeys } from '@/server/auth/webauthn';
import {
  AddPasskey,
  ChangePasswordForm,
  DeletePasskeyButton,
  LockSettingsForm,
  TotpSection,
} from './security-client';

export const metadata = { title: 'Segurança' };

export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ bemvindo?: string }>;
}) {
  const s = await requireUnlocked();
  const passkeys = await listPasskeys(s.user.id);
  const welcome = (await searchParams).bemvindo === '1';
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title="Segurança" />
      {welcome && passkeys.length === 0 ? (
        <Notice tone="success" className="text-[15px]">
          Acesso criado! Ative a entrada com digital para não precisar digitar a senha no celular.
        </Notice>
      ) : null}

      <Card className="flex flex-col gap-4">
        <CardTitle>Entrada com digital (passkeys)</CardTitle>
        <p className="text-sm text-ink-2">
          No Android, a passkey fica no aparelho (ou no Gerenciador de Senhas do Google). No PC, use
          o Windows Hello ou o celular via QR code. Cadastre em cada dispositivo que você usa.
        </p>
        {passkeys.length > 0 ? (
          <ul className="flex flex-col">
            {passkeys.map((p) => (
              <li
                key={p.id}
                className="flex items-center gap-3 border-t border-surface-2 py-2.5 first:border-t-0"
              >
                <div className="flex flex-1 flex-col">
                  <span className="font-bold">{p.deviceName}</span>
                  <span className="text-xs text-ink-2">
                    criada {dateTimeBR(p.createdAt)} · último uso {dateTimeBR(p.lastUsedAt)}
                    {p.backedUp ? ' · sincronizada' : ''}
                  </span>
                </div>
                <DeletePasskeyButton id={p.id} name={p.deviceName} />
              </li>
            ))}
          </ul>
        ) : null}
        <AddPasskey highlight={passkeys.length === 0} />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Bloqueio do app</CardTitle>
        <p className="text-sm text-ink-2">
          Mesmo com a sessão válida, o app pede a digital (ou a senha) depois de um tempo sem uso e
          ao ser reaberto.
        </p>
        <LockSettingsForm
          lockTimeoutMinutes={s.settings.lockTimeoutMinutes}
          relockAfterBackgroundSeconds={s.settings.relockAfterBackgroundSeconds}
        />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Verificação em duas etapas</CardTitle>
        <p className="text-sm text-ink-2">
          Opcional, para o login com senha. {s.user.totpEnabled ? 'Ativada.' : 'Desativada.'} Inclui
          códigos de recuperação para o caso de perder o celular.
        </p>
        <TotpSection enabled={s.user.totpEnabled} />
      </Card>

      <Card className="flex flex-col gap-4">
        <CardTitle>Senha</CardTitle>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
