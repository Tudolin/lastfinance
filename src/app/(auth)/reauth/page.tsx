import { UnlockPanel } from '@/components/auth/unlock-panel';
import { countPasskeys } from '@/server/auth/passkeys-count';
import { requireSession } from '@/server/auth/request';

export const metadata = { title: 'Confirme que é você' };

export default async function ReauthPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const s = await requireSession();
  const { next } = await searchParams;
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return (
    <UnlockPanel
      title="Confirme que é você"
      subtitle="Esta ação é sensível. Confirme com a digital ou com a senha."
      next={target}
      hasPasskey={(await countPasskeys(s.user.id)) > 0}
    />
  );
}
