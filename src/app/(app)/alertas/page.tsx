import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { relativeTime } from '@/lib/format';
import { vapidPublicKey } from '@/server/adapters/push/sender';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import { ALERT_TYPES, listAlerts } from '@/server/services/alerts';
import { getAppSettings } from '@/server/services/settings';
import { AlertPrefsForm, InboxButtons, PushToggle } from './alerts-client';

export const metadata = { title: 'Alertas' };

export default async function AlertsPage() {
  await requireUnlocked();
  const [alerts, settings, devices] = await Promise.all([
    listAlerts(),
    getAppSettings(),
    getDb().select({ id: schema.pushSubscription.id }).from(schema.pushSubscription),
  ]);
  const unread = alerts.filter((a) => !a.readAt).length;
  return (
    <>
      <PageHeader title="Alertas" kicker={unread ? `${unread} não lido(s)` : 'Tudo em dia'} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col gap-3 py-4 lg:col-span-2" aria-label="Caixa de alertas">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Recebidos</CardTitle>
            <InboxButtons unread={unread} />
          </div>
          {alerts.length === 0 ? (
            <p className="text-sm text-ink-2">
              Nenhum alerta ainda. O app verifica de hora em hora: gastos grandes, orçamentos,
              previsão negativa, faturas, salário atrasado, conexões e assinaturas.
            </p>
          ) : (
            <ul className="flex flex-col">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="border-t border-surface-2 py-2.5 first:border-t-0"
                  data-testid="alert-row"
                >
                  <Link
                    href={a.url ?? '/alertas'}
                    className="flex flex-col gap-0.5 text-ink no-underline"
                  >
                    <span className={cn('flex items-center gap-2', !a.readAt && 'font-extrabold')}>
                      {!a.readAt ? (
                        <span className="size-2 rounded-full bg-[#2e9a78]" aria-label="não lido" />
                      ) : null}
                      {a.title}
                    </span>
                    <span className="money-sensitive text-sm text-ink-2">{a.body}</span>
                    <span className="text-xs text-ink-3">
                      {ALERT_TYPES[a.type as keyof typeof ALERT_TYPES] ?? a.type} ·{' '}
                      {relativeTime(a.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3">
            <CardTitle>Notificações no celular</CardTitle>
            <p className="text-sm text-ink-2">
              {devices.length
                ? `${devices.length} aparelho(s) recebendo notificações.`
                : 'Nenhum aparelho recebendo notificações ainda.'}
            </p>
            <PushToggle publicKey={vapidPublicKey()} />
          </Card>
          <Card className="flex flex-col gap-3">
            <CardTitle>Preferências</CardTitle>
            <AlertPrefsForm
              types={ALERT_TYPES}
              off={settings.alertsOff}
              largeExpense={settings.alertLargeExpenseCents}
              quietStart={settings.quietStartHour}
              quietEnd={settings.quietEndHour}
            />
          </Card>
        </div>
      </div>
    </>
  );
}
