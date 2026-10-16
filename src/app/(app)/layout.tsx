import type { ReactNode } from 'react';
import { BottomNav } from '@/components/shell/bottom-nav';
import { LockGuard } from '@/components/shell/lock-guard';
import { Sidebar } from '@/components/shell/sidebar';
import { relativeTime } from '@/lib/format';
import { requireUnlocked } from '@/server/auth/request';
import { getSyncStatus } from '@/server/queries/accounts';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const s = await requireUnlocked();
  const sync = await getSyncStatus();
  const names = sync.connections.map((c) => c.name).join(' e ') || 'Nenhuma conta conectada';
  const label = sync.lastSuccessAt
    ? `Sincronizado ${relativeTime(sync.lastSuccessAt)}`
    : 'Ainda não sincronizado';
  return (
    <div className="flex min-h-dvh">
      <Sidebar syncLabel={label} syncDetail={names} />
      <div className="min-w-0 flex-1 pb-28 lg:pb-12">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-5 px-4 pt-5 lg:px-10 lg:pt-7">
          {children}
        </div>
      </div>
      <BottomNav />
      <LockGuard
        lockTimeoutMinutes={s.settings.lockTimeoutMinutes}
        relockAfterBackgroundSeconds={s.settings.relockAfterBackgroundSeconds}
      />
    </div>
  );
}
