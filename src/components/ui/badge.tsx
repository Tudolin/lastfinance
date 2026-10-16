import type { TxKind } from '@/domain/classification/types';
import { TX_KIND_LABEL } from '@/domain/classification/types';
import { cn } from '@/lib/cn';

const KIND_STYLE: Record<TxKind, string> = {
  expense: 'bg-danger-soft text-danger-ink',
  refund: 'bg-primary-soft text-primary-on-soft',
  income: 'bg-primary-soft text-primary-on-soft',
  internal_transfer: 'bg-surface-2 text-ink-2',
  card_payment: 'bg-surface-2 text-ink-2',
  adjustment: 'bg-surface-2 text-ink-2',
  investment_in: 'bg-info-soft text-info-ink',
  investment_out: 'bg-info-soft text-info-ink',
};

const SHORT: Partial<Record<TxKind, string>> = {
  internal_transfer: 'Transferência',
  card_payment: 'Pag. de fatura',
  investment_in: 'Investido',
  investment_out: 'Resgate',
};

export function KindBadge({ kind, className }: { kind: TxKind; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap',
        KIND_STYLE[kind],
        className,
      )}
    >
      {SHORT[kind] ?? TX_KIND_LABEL[kind]}
    </span>
  );
}

export function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold',
        className,
      )}
    >
      {children}
    </span>
  );
}
