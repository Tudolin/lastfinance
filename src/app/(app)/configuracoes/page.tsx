import { ChevronRight, LogOut, MonitorSmartphone, Shield } from 'lucide-react';
import Link from 'next/link';
import { logoutAction } from '@/app/(auth)/actions';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

export const metadata = { title: 'Configurações' };

export default function SettingsPage() {
  const item = (href: string, Icon: typeof Shield, title: string, desc: string) => (
    <Link
      href={href}
      className="flex items-center gap-3 border-t border-surface-2 py-3.5 text-ink no-underline first:border-t-0"
    >
      <Icon className="size-5 text-ink-2" aria-hidden="true" />
      <span className="flex flex-1 flex-col">
        <span className="font-bold">{title}</span>
        <span className="text-xs text-ink-2">{desc}</span>
      </span>
      <ChevronRight className="size-4 text-ink-3" aria-hidden="true" />
    </Link>
  );
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title="Configurações" />
      <Card className="py-1">
        {item(
          '/configuracoes/seguranca',
          Shield,
          'Segurança',
          'Digital (passkeys), bloqueio do app, 2FA e senha',
        )}
        {item(
          '/configuracoes/sessoes',
          MonitorSmartphone,
          'Sessões ativas',
          'Veja e encerre sessões em outros dispositivos',
        )}
      </Card>
      <form action={logoutAction}>
        <Button type="submit" variant="outline">
          <LogOut className="size-4" aria-hidden="true" />
          Sair
        </Button>
      </form>
    </div>
  );
}
