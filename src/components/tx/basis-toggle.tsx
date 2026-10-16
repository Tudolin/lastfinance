import Link from 'next/link';
import { cn } from '@/lib/cn';

/** Alterna caixa × competência via querystring (funciona sem JavaScript). */
export function BasisToggle({
  basis,
  hrefFor,
}: {
  basis: 'cash' | 'accrual';
  hrefFor: (b: 'cash' | 'accrual') => string;
}) {
  const item = (b: 'cash' | 'accrual', label: string) => (
    <Link
      href={hrefFor(b)}
      aria-current={basis === b ? 'true' : undefined}
      className={cn(
        'flex min-h-9 items-center rounded-lg px-3.5 text-[13px] font-bold no-underline',
        basis === b ? 'bg-surface text-ink shadow-sm' : 'text-ink-2',
      )}
    >
      {label}
    </Link>
  );
  return (
    <div role="group" aria-label="Regime" className="flex rounded-[10px] bg-track p-1">
      {item('cash', 'Caixa')}
      {item('accrual', 'Competência')}
    </div>
  );
}
