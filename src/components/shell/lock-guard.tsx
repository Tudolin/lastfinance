'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { lockAction } from '@/app/(auth)/actions';

/**
 * Bloqueio no cliente (o servidor também bloqueia sozinho por inatividade):
 * - depois de N minutos sem interação;
 * - ao voltar para o app depois de ficar em segundo plano por mais de X segundos.
 */
export function LockGuard({
  lockTimeoutMinutes,
  relockAfterBackgroundSeconds,
}: {
  lockTimeoutMinutes: number;
  relockAfterBackgroundSeconds: number;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hiddenAt = useRef<number | null>(null);
  const locking = useRef(false);

  useEffect(() => {
    const lock = async () => {
      if (locking.current) return;
      locking.current = true;
      document.documentElement.dataset.hideValues = 'true'; // esconde já, antes da navegação
      await lockAction().catch(() => {});
      router.replace(`/unlock?next=${encodeURIComponent(location.pathname + location.search)}`);
    };
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(lock, lockTimeoutMinutes * 60_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now();
      } else if (
        hiddenAt.current &&
        Date.now() - hiddenAt.current > relockAfterBackgroundSeconds * 1000
      ) {
        void lock();
      }
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);
    reset();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [lockTimeoutMinutes, relockAfterBackgroundSeconds, router]);

  return null;
}
