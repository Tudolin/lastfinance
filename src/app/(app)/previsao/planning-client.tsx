'use client';

import { RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { refreshPlanningAction } from './actions';

export function RefreshPlanningButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await refreshPlanningAction();
          setDone(true);
          router.refresh();
        })
      }
    >
      <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} aria-hidden="true" />
      {pending ? 'Recalculando…' : done ? 'Recalculado' : 'Recalcular previsão'}
    </Button>
  );
}
