import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Money } from '@/components/money';
import { KindBadge } from '@/components/ui/badge';
import { Card, CardTitle } from '@/components/ui/card';
import { TX_KIND_LABEL } from '@/domain/classification/types';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import { getTransaction } from '@/server/queries/transactions';
import { EditTransactionForm } from './edit-form';

export const metadata = { title: 'Transação' };

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const data = await getTransaction(id);
  if (!data) notFound();
  const t = data.t;
  const isCard = data.accountKind === 'credit_card';
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <Link
        href="/transacoes"
        className="flex min-h-11 items-center gap-2 text-sm font-bold no-underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Transações
      </Link>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <h1 className="text-xl font-extrabold">{t.userDescription ?? t.srcDescription}</h1>
            <span className="text-sm text-ink-2">
              {data.institution} · {data.accountName}
              {t.status === 'PENDING' ? ' · pendente' : ''}
            </span>
          </div>
          <Money cents={t.amountCents} signed tone="auto" className="text-2xl font-extrabold" />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div>
            <dt className="font-semibold text-ink-2">
              {isCard ? 'Data da compra (competência)' : 'Data'}
            </dt>
            <dd className="font-bold">{formatBR(t.competenceDate as LocalDate)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink-2">Sai do caixa em</dt>
            <dd className="font-bold">{formatBR(t.cashDate as LocalDate)}</dd>
          </div>
          {t.installmentNumber ? (
            <div>
              <dt className="font-semibold text-ink-2">Parcela</dt>
              <dd className="font-bold">
                {t.installmentNumber} de {t.installmentTotal}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="font-semibold text-ink-2">Tipo</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <KindBadge kind={t.kind} />
              <span className="text-xs text-ink-2">
                {t.kindSource === 'user'
                  ? 'definido por você'
                  : `${t.kindReason ?? 'automático'} · confiança ${Math.round(t.kindConfidence * 100)}%`}
              </span>
            </dd>
          </div>
        </dl>
        {data.linked.length ? (
          <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 text-sm">
            <span className="font-bold text-ink-2">
              {t.refundOfTransactionId ? 'Compra estornada' : 'Outra ponta'}
            </span>
            {data.linked.map((l) => (
              <Link
                key={l.id}
                href={`/transacoes/${l.id}`}
                className="flex items-center gap-2 text-ink no-underline"
              >
                <span className="flex-1">
                  {l.description} · {l.accountName} · {formatBR(l.date as LocalDate)}
                </span>
                <Money cents={l.amountCents} signed />
              </Link>
            ))}
          </div>
        ) : null}
      </Card>
      <Card className="flex flex-col gap-4">
        <CardTitle>Editar</CardTitle>
        <EditTransactionForm
          id={t.id}
          description={t.userDescription ?? t.srcDescription}
          notes={t.notes ?? ''}
          tags={t.tags}
          userKind={t.userKind}
          autoKindLabel={t.kindSource === 'user' ? 'deixar o app decidir' : TX_KIND_LABEL[t.kind]}
        />
      </Card>
    </div>
  );
}
