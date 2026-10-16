'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <Card className="flex flex-col items-start gap-3">
      <h1 className="text-xl font-extrabold">Algo deu errado ao carregar esta tela</h1>
      <p className="text-sm text-ink-2">
        O erro foi registrado (sem dados financeiros). Tente de novo; se persistir, veja a tela de
        status.
      </p>
      <Button onClick={reset}>Tentar de novo</Button>
    </Card>
  );
}
