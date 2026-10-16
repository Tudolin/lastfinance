'use client';

import { Eye, EyeOff, Lock, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { lockAction } from '@/app/(auth)/actions';
import { useHideValues } from '@/components/providers';
import { Button } from '@/components/ui/button';

export function HeaderActions({ compact = false }: { compact?: boolean }) {
  const { hidden, toggle } = useHideValues();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [pending, start] = useTransition();
  const lock = () =>
    start(async () => {
      await lockAction();
      router.replace('/unlock');
    });
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size={compact ? 'icon' : 'md'}
        onClick={toggle}
        aria-pressed={hidden}
        aria-label={hidden ? 'Mostrar valores' : 'Ocultar valores'}
      >
        {hidden ? (
          <EyeOff className="size-[18px]" aria-hidden="true" />
        ) : (
          <Eye className="size-[18px]" aria-hidden="true" />
        )}
        {compact ? null : <span>{hidden ? 'Mostrar valores' : 'Ocultar valores'}</span>}
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        aria-label={resolvedTheme === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
        className="hidden sm:inline-flex"
      >
        <Sun className="hidden size-[18px] dark:block" aria-hidden="true" />
        <Moon className="size-[18px] dark:hidden" aria-hidden="true" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={lock}
        disabled={pending}
        aria-label="Bloquear o app"
      >
        <Lock className="size-[18px]" aria-hidden="true" />
      </Button>
    </div>
  );
}
