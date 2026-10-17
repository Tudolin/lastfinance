'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { setSubscriptionAction } from './actions';

export function SubscriptionToggle({ id, name, on }: { id: string; name: string; on: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant={on ? 'ghost' : 'outline'}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setSubscriptionAction(id, !on);
          router.refresh();
        })
      }
      aria-label={on ? `${name} não é assinatura` : `Marcar ${name} como assinatura`}
    >
      {on ? 'Não é assinatura' : 'É assinatura'}
    </Button>
  );
}
