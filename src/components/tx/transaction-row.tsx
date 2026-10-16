import Link from 'next/link';
import type { TxKind } from '@/domain/classification/types';
import { KIND_EFFECT } from '@/domain/classification/types';
import { KindBadge } from '@/components/ui/badge';
import { Money } from '@/components/money';

export type TxRowData = {
  id: string;
  description: string;
  amountCents: number;
  kind: TxKind;
  kindSource: string;
  kindConfidence: number;
  accountName: string;
  institution: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  status: string;
};

const NEUTRAL_NOTE: Partial<Record<TxKind, string>> = {
  internal_transfer: 'não conta como gasto',
  card_payment: 'não é despesa',
  adjustment: 'neutro',
};

export function TransactionRow({ t }: { t: TxRowData }) {
  const neutral = !KIND_EFFECT[t.kind].expense && !KIND_EFFECT[t.kind].income;
  const review = t.kindSource === 'auto' && t.kindConfidence < 0.7;
  return (
    <Link
      href={`/transacoes/${t.id}`}
      className="flex items-center gap-3 border-t border-surface-2 py-3 text-ink no-underline first:border-t-0 hover:bg-surface-2/50"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-bold">{t.description}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2">
          {t.installmentNumber && t.installmentTotal ? (
            <span className="rounded-md bg-ink px-1.5 py-0.5 font-extrabold text-bg">
              {t.installmentNumber}/{t.installmentTotal}
            </span>
          ) : null}
          <KindBadge kind={t.kind} className="px-1.5 py-0.5" />
          <span>
            {t.institution} · {t.accountName}
            {NEUTRAL_NOTE[t.kind] ? ` · ${NEUTRAL_NOTE[t.kind]}` : ''}
            {t.status === 'PENDING' ? ' · pendente' : ''}
          </span>
          {review ? (
            <span className="font-bold text-warn-ink dark:text-warn">· confirmar</span>
          ) : null}
        </span>
      </div>
      <Money
        cents={t.amountCents}
        signed
        tone={neutral || KIND_EFFECT[t.kind].invested ? 'muted' : 'auto'}
        className="text-[15px] font-extrabold"
      />
    </Link>
  );
}
