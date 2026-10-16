import { Laptop, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { dateTimeBR, relativeTime } from '@/lib/format';
import { requireUnlocked } from '@/server/auth/request';
import { listActiveSessions } from '@/server/auth/session';
import { RevokeButton, RevokeOthersButton } from './sessions-client';

export const metadata = { title: 'Sessões' };

function describe(ua: string | null) {
  if (!ua) return { name: 'Dispositivo desconhecido', mobile: false };
  const mobile = /Android|iPhone|iPad/i.test(ua);
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad/i.test(ua)
      ? 'iOS'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Outro';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Navegador';
  return { name: `${browser} no ${os}`, mobile };
}

export default async function SessionsPage() {
  const s = await requireUnlocked();
  const sessions = await listActiveSessions(s.user.id);
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title="Sessões ativas" />
      <p className="-mt-2 text-sm text-ink-2">
        Cada dispositivo tem a sua própria sessão. Encerre as que você não reconhece.
      </p>
      <Card className="flex flex-col py-2">
        {sessions.map((x) => {
          const d = describe(x.userAgent);
          const Icon = d.mobile ? Smartphone : Laptop;
          return (
            <div
              key={x.id}
              className="flex items-center gap-3 border-t border-surface-2 py-3 first:border-t-0"
            >
              <Icon className="size-5 text-ink-2" aria-hidden="true" />
              <div className="flex flex-1 flex-col">
                <span className="font-bold">
                  {d.name}
                  {x.id === s.sessionId ? (
                    <span className="ml-2 text-xs font-extrabold text-primary-on-soft">
                      este dispositivo
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-ink-2">
                  ativo {relativeTime(x.lastSeenAt)} · desde {dateTimeBR(x.createdAt)} ·{' '}
                  {x.ipPrefix ?? 'IP desconhecido'}
                </span>
              </div>
              {x.id !== s.sessionId ? <RevokeButton id={x.id} /> : null}
            </div>
          );
        })}
      </Card>
      {sessions.length > 1 ? <RevokeOthersButton /> : null}
    </div>
  );
}
