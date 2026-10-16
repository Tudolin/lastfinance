import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { dateTimeBR } from '@/lib/format';
import { getSyncLogs } from '@/server/queries/accounts';
import { recentWebhookEvents } from '@/server/services/webhooks';
import { requireUnlocked } from '@/server/auth/request';

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
        <Card className="flex flex-col gap-2">
          <CardTitle>Webhooks recebidos</CardTitle>
          {events.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nenhum evento ainda. Veja no README como registrar o webhook na Pluggy.
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
