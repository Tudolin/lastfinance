import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { dateTimeBR } from '@/lib/format';
import { getSyncLogs } from '@/server/queries/accounts';
import { recentWebhookEvents } from '@/server/services/webhooks';
import { requireUnlocked } from '@/server/auth/request';
import { inngestDiagnostics, type KeyInfo } from '@/server/jobs/inngest-diag';
import { getWebhookStatus, type WebhookStatus } from '@/server/services/pluggy-webhook';
import { InngestPing } from './inngest-ping';
import { WebhookRegister } from './webhook-register';

export const metadata = { title: 'Status da sincronização' };

const STATUS_LABEL: Record<string, string> = {
  running: 'em andamento',
  success: 'ok',
  partial: 'parcial',
  error: 'erro',
  received: 'recebido',
  enqueued: 'na fila',
  processed: 'processado',
  failed: 'falhou',
  ignored: 'ignorado',
};

function describeKey(k: KeyInfo) {
  if (!k.present) return 'ausente';
  return [
    k.prefix ?? null,
    `${k.length} caracteres`,
    k.last4 ? `termina em …${k.last4}` : null,
    k.untrimmed ? 'tinha espaço/quebra de linha (o app ignora)' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function Dot({ status }: { status: string }) {
  const bad = status === 'error' || status === 'failed';
  const busy = status === 'running' || status === 'enqueued' || status === 'received';
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2 shrink-0 ${bad ? 'rounded-[2px] bg-danger' : busy ? 'rounded-full bg-warn' : 'rounded-full bg-[#0b6e55]'}`}
    />
  );
}

export default async function StatusPage() {
  await requireUnlocked();
  const [logs, events] = await Promise.all([getSyncLogs(50), recentWebhookEvents(30)]);
  const diag = inngestDiagnostics();
  const webhook: WebhookStatus | null = await getWebhookStatus().catch(() => null);
  const diagRows: [string, string][] = [
    [
      'Deploy',
      [diag.deploy.vercelEnv, diag.deploy.branch, diag.deploy.commit].filter(Boolean).join(' · ') ||
        '—',
    ],
    ['INNGEST_EVENT_KEY', describeKey(diag.eventKey)],
    ['INNGEST_SIGNING_KEY', describeKey(diag.signingKey)],
    ['INNGEST_SIGNING_KEY_FALLBACK', describeKey(diag.signingKeyFallback)],
    [
      'Ambiente enviado (x-inngest-env)',
      diag.envHeaderStripped
        ? `nenhum (o app remove "${diag.envHeader ?? ''}" em produção)`
        : (diag.envHeader ?? 'nenhum'),
    ],
    ['Envio de eventos', diag.eventApi],
    ['Variáveis que mudam o destino', diag.overrides.join(', ') || 'nenhuma'],
  ];
  return (
    <>
      <PageHeader title="Status da sincronização" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-2">
          <CardTitle>Execuções de sincronização</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left text-xs tracking-wide text-ink-2 uppercase">
                  <th className="py-2 pr-2 font-bold">Início</th>
                  <th className="p-2 font-bold">Instituição</th>
                  <th className="p-2 font-bold">Origem</th>
                  <th className="p-2 font-bold">Resultado</th>
                  <th className="py-2 pl-2 text-right font-bold">Transações</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(({ log, connectorName }) => (
                  <tr key={log.id} className="border-t border-surface-2 align-top">
                    <td className="py-2 pr-2 whitespace-nowrap">{dateTimeBR(log.startedAt)}</td>
                    <td className="p-2">{connectorName ?? '—'}</td>
                    <td className="p-2">{log.trigger}</td>
                    <td className="p-2">
                      <span className="flex items-center gap-1.5">
                        <Dot status={log.status} />
                        {STATUS_LABEL[log.status]}
                        {log.finishedAt
                          ? ` · ${Math.max(1, Math.round((log.finishedAt.getTime() - log.startedAt.getTime()) / 1000))} s`
                          : ''}
                      </span>
                      {log.errorMessage ? (
                        <span className="block text-xs text-danger-ink dark:text-danger">
                          {log.errorCode}: {log.errorMessage}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pl-2 text-right whitespace-nowrap">
                      {log.counts.transactions ?? 0} lidas · +{log.counts.inserted ?? 0} · −
                      {log.counts.deleted ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.length === 0 ? <p className="text-sm text-ink-2">Nenhuma execução ainda.</p> : null}
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Fila (Inngest) neste deploy</CardTitle>
          <dl className="grid grid-cols-1 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr] sm:gap-x-4">
            {diagRows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-semibold text-ink-2">{k}</dt>
                <dd className="font-mono text-xs break-all">{v}</dd>
              </div>
            ))}
          </dl>
          <InngestPing />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Avisos da Pluggy (webhook)</CardTitle>
          <p className="text-[13px] text-ink-2">
            A Pluggy atualiza suas contas sozinha algumas vezes por dia e avisa o app por este
            webhook. Sem ele, o app só busca novidades na rotina de reserva (a cada 6 horas).
          </p>
          {webhook ? (
            <dl className="grid grid-cols-1 gap-y-2 text-[13px] sm:grid-cols-[auto_1fr] sm:gap-x-4">
              <div className="contents">
                <dt className="font-semibold text-ink-2">Situação</dt>
                <dd className="flex items-center gap-1.5">
                  <Dot status={webhook.registered ? 'success' : 'error'} />
                  {webhook.registered ? 'registrado' : 'não registrado para este endereço'}
                </dd>
              </div>
              <div className="contents">
                <dt className="font-semibold text-ink-2">Endereço</dt>
                <dd className="font-mono text-xs break-all">{webhook.expectedUrl}</dd>
              </div>
              {webhook.others.length ? (
                <div className="contents">
                  <dt className="font-semibold text-ink-2">Outros (serão trocados)</dt>
                  <dd className="font-mono text-xs break-all">{webhook.others.join(', ')}</dd>
                </div>
              ) : null}
              {!webhook.secretSet ? (
                <div className="contents">
                  <dt className="font-semibold text-ink-2">PLUGGY_WEBHOOK_SECRET</dt>
                  <dd className="text-xs text-danger-ink dark:text-danger">ausente</dd>
                </div>
              ) : null}
            </dl>
          ) : (
            <p className="text-sm text-danger-ink dark:text-danger">
              Não consegui consultar a Pluggy agora.
            </p>
          )}
          <WebhookRegister registered={webhook?.registered ?? false} />
        </Card>
        <Card className="flex flex-col gap-2">
          <CardTitle>Webhooks recebidos</CardTitle>
          {events.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nenhum evento ainda. Registre o webhook no quadro ao lado.
            </p>
          ) : null}
          <ul className="flex flex-col">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-2.5 border-t border-surface-2 py-2.5 text-[13px] first:border-t-0"
              >
                <Dot status={e.status} />
                <span className="flex-1">
                  <strong>{e.event}</strong> · {dateTimeBR(e.receivedAt)}
                  {e.error ? (
                    <span className="block text-xs text-danger-ink dark:text-danger">
                      {e.error}
                    </span>
                  ) : null}
                </span>
                <span className="text-ink-2">{STATUS_LABEL[e.status]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
