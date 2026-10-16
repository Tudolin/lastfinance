import { redirect } from 'next/navigation';
import { UnlockPanel } from '@/components/auth/unlock-panel';
import { countPasskeys } from '@/server/auth/passkeys-count';
import { requireSession } from '@/server/auth/request';

export const metadata = { title: 'App bloqueado' };

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const s = await requireSession();
  const { next } = await searchParams;
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (!s.locked) redirect(target);
  return (
    <UnlockPanel
      title="App bloqueado"
      subtitle={`Bloqueado depois de ${s.settings.lockTimeoutMinutes} minutos sem uso. Nenhum valor fica visível até você desbloquear.`}
      next={target}
      hasPasskey={(await countPasskeys(s.user.id)) > 0}
    />
  );
}
