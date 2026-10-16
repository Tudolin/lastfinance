'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { revokeOtherSessionsAction, revokeSessionAction } from '../actions';

export function RevokeButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => start(async () => (await revokeSessionAction(id), router.refresh()))}
    >
      Encerrar
    </Button>
  );
}

export function RevokeOthersButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="danger"
      disabled={pending}
      onClick={() => start(async () => (await revokeOtherSessionsAction(), router.refresh()))}
    >
      Encerrar todas as outras sessões
    </Button>
  );
}
