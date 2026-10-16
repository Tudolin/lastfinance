import { CircleCheck, CircleX, Clock } from 'lucide-react';
import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { Pill } from '@/components/ui/badge';
import { dateTimeBR, relativeTime } from '@/lib/format';
import { env } from '@/lib/env';
import { getConnections, getSyncLogs } from '@/server/queries/accounts';
import { ConnectButton, SyncButtons } from './connect-button';
import { ImportItemForm } from './import-form';

export const metadata = { title: 'Contas conectadas' };

const NEEDS_ACTION = new Set([
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'WAITING_USER_ACTION',
  'OUTDATED',
]);

function statusInfo(status: string, errorMessage: string | null) {
  if (NEEDS_ACTION.has(status)) {
    return {
      tone: 'danger' as const,
      label: 'Precisa reconectar',
      detail:
        errorMessage ??
        'O banco pediu uma nova autorização. Os dados param de atualizar até você reconectar.',
    };
  }
  if (status === 'UPDATING' || status === 'MERGING')
    return { tone: 'info' as const, label: 'Atualizando…', detail: null };
  return { tone: 'ok' as const, label: 'Atualizado', detail: null };
}

export default async function AccountsPage() {
  const [connections, logs] = await Promise.all([getConnections(), getSyncLogs(8)]);
  const fake = env().PLUGGY_FAKE;
  return (
    <>
      <PageHeader title="Contas conectadas" />
      <p className="-mt-2 text-sm text-ink-2">
        Somente leitura, via Open Finance (Pluggy). O app nunca movimenta dinheiro.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          {connections.map((c) => {
            const st = statusInfo(c.status, c.errorMessage);
            return (
              <Card
                key={c.id}
                className={`flex flex-col gap-3 ${st.tone === 'danger' ? 'border-2 border-[#e0a49c] dark:border-[#7a3a32]' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-1 flex-col gap-0.5">
                    <h2 className="text-base font-extrabold">{c.connectorName}</h2>
                    <span className="text-xs text-ink-2">
                      {c.accounts.map((a) => a.name).join(' · ') || 'Sem contas ainda'}
                      {c.isOpenFinance ? ' · Open Finance' : ''}
                    </span>
                  </div>
                  {st.tone === 'ok' ? (
                    <Pill className="bg-primary-soft text-primary-on-soft">
                      <CircleCheck className="size-3.5" aria-hidden="true" />
                      {st.label}
                    </Pill>
                  ) : st.tone === 'info' ? (
                    <Pill className="bg-surface-2 text-ink-2">
                      <Clock className="size-3.5" aria-hidden="true" />
                      {st.label}
                    </Pill>
                  ) : null}
                </div>
                {st.tone === 'danger' ? (
                  <div className="flex gap-2.5 rounded-xl bg-danger-soft p-3 text-danger-ink">
                    <CircleX className="size-5 shrink-0" aria-hidden="true" />
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-extrabold">{st.label}</span>
                      <span className="text-[13px]">{st.detail}</span>
                    </div>
                  </div>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-[13px]">
                  <div>
                    <dt className="font-semibold text-ink-2">Última sincronização</dt>
                    <dd className="font-extrabold">
                      {c.lastSyncedAt ? relativeTime(c.lastSyncedAt) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">Próxima automática</dt>
                    <dd className="font-extrabold">{dateTimeBR(c.nextAutoSyncAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">Histórico</dt>
                    <dd className="font-extrabold">
                      {c.backfillState === 'done'
                        ? '12 meses carregados'
                        : c.lastSyncedAt
                          ? 'carregando…'
                          : 'aguardando a 1ª sincronização'}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-ink-2">Consentimento até</dt>
                    <dd className="font-extrabold">
                      {dateTimeBR(c.consentExpiresAt).slice(0, 10)}
                    </dd>
                  </div>
                </dl>
                {st.tone === 'danger' ? (
                  <ConnectButton reconnectItemId={c.pluggyItemId} fake={fake} />
                ) : (
                  <SyncButtons pluggyItemId={c.pluggyItemId} />
                )}
                <span className="text-xs text-ink-2">
                  “Atualizar no banco” usa a cota mensal do Open Finance. A Pluggy já atualiza
                  sozinha até 4 vezes por dia.
                </span>
              </Card>
            );
          })}
          <ConnectButton fake={fake} />
        </div>
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-3">
            <CardTitle>Importar conexão existente</CardTitle>
            <ImportItemForm />
          </Card>
          <Card className="flex flex-col gap-1">
            <div className="flex items-center pb-2">
              <CardTitle className="mr-auto">Sincronizações recentes</CardTitle>
              <Link href="/status" className="text-[13px] font-bold">
                Status
              </Link>
            </div>
            {logs.length === 0 ? <p className="text-sm text-ink-2">Nenhuma ainda.</p> : null}
            {logs.map(({ log, connectorName }) => (
              <div
                key={log.id}
                className="flex items-center gap-2.5 border-t border-surface-2 py-2.5 text-[13px] first:border-t-0"
              >
                <span
                  className={`size-2 shrink-0 ${log.status === 'error' ? 'rounded-[2px] bg-danger' : 'rounded-full bg-[#0b6e55]'}`}
                  aria-hidden="true"
                />
                <span className="mr-auto">
                  <strong>{dateTimeBR(log.startedAt).slice(0, 16)}</strong> · {connectorName ?? '—'}{' '}
                  · {log.trigger}
                </span>
                <span className="text-ink-2">
                  {log.status === 'error'
                    ? 'erro'
                    : log.status === 'running'
                      ? 'em andamento'
                      : `+${log.counts.inserted ?? 0} novas`}
                </span>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
