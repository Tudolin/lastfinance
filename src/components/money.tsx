import { formatBRL } from '@/domain/money';
import { cn } from '@/lib/cn';

/**
 * Valor em R$ (pt-BR). Respeita o modo "ocultar valores" (atributo no <html>, sem re-render).
 * tone="auto": verde para entradas; neutro para movimentações que não contam como gasto.
 */
export function Money({
  cents,
  signed = false,
  tone = 'plain',
  className,
}: {
  cents: number;
  signed?: boolean;
  tone?: 'plain' | 'auto' | 'muted';
  className?: string;
}) {
  const color =
    tone === 'muted'
      ? 'text-ink-2'
      : tone === 'auto' && cents > 0
        ? 'text-primary-on-soft dark:text-[#7fd8b5]'
        : '';
  const text = formatBRL(cents, { signed }).replace('-R$', '−R$');
  return (
    <span className={cn('whitespace-nowrap', color, className)}>
      <span className="money-value">{text}</span>
      <span className="money-hidden" aria-label="valor oculto">
        R$ •••••
      </span>
    </span>
  );
}
