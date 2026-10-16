import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { formatBR } from '@/domain/dates/local-date';
import { getForecastView } from '@/server/queries/forecast';
import { getAccountOptions } from '@/server/queries/income';
import { CanSpendForm } from './can-spend-client';

export const metadata = { title: 'Posso gastar?' };

export default async function CanSpendPage() {
  const [v, accounts] = await Promise.all([getForecastView(90), getAccountOptions()]);
  return (
    <>
      <PageHeader title="Posso gastar?" kicker="Simule antes de comprar" />
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Agora">
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Livre para gastar por dia</span>
          <Money cents={v.free.cents} className="text-2xl font-extrabold" />
          <span className="text-xs text-ink-2">
            até {formatBR(v.free.until)}, sem furar a reserva
          </span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">
            Menor saldo previsto (90 dias)
          </span>
          <Money cents={v.base.min.balance} className="text-2xl font-extrabold" />
          <span className="text-xs text-ink-2">em {formatBR(v.base.min.date)}</span>
        </Card>
        <Card className="flex flex-col gap-1 p-4">
          <span className="text-[13px] font-semibold text-ink-2">Reserva mínima</span>
          <Money cents={v.reserveCents} className="text-2xl font-extrabold" />
          <Link href="/configuracoes/preferencias" className="text-xs font-bold">
            Alterar
          </Link>
        </Card>
      </section>
      <Card>
        <CanSpendForm accounts={accounts} today={v.today} />
      </Card>
    </>
  );
}
