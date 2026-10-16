import type { SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type CategoryOption = {
  id: string;
  name: string;
  parentId: string | null;
  kind: 'expense' | 'income';
  archivedAt?: Date | null;
};

/** Select agrupado por categoria-mãe (despesas e receitas separadas). */
export function CategorySelect({
  categories,
  emptyLabel = 'Sem categoria',
  kind,
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  categories: CategoryOption[];
  emptyLabel?: string;
  kind?: 'expense' | 'income';
}) {
  const active = categories.filter((c) => !c.archivedAt && (!kind || c.kind === kind));
  const roots = active.filter((c) => !c.parentId);
  return (
    <select
      className={cn(
        'min-h-12 rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink',
        className,
      )}
      {...props}
    >
      <option value="">{emptyLabel}</option>
      {(['expense', 'income'] as const)
        .filter((k) => !kind || k === kind)
        .map((k) => (
          <optgroup key={k} label={k === 'expense' ? 'Despesas' : 'Receitas'}>
            {roots
              .filter((r) => r.kind === k)
              .flatMap((r) => {
                const kids = active.filter((c) => c.parentId === r.id);
                return [
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>,
                  ...kids.map((c) => (
                    <option key={c.id} value={c.id}>
                      {`  ${r.name} › ${c.name}`}
                    </option>
                  )),
                ];
              })}
          </optgroup>
        ))}
    </select>
  );
}

export function labelFor(
  id: string | null | undefined,
  categories: CategoryOption[],
): string | null {
  if (!id) return null;
  const c = categories.find((x) => x.id === id);
  if (!c) return null;
  const p = c.parentId ? categories.find((x) => x.id === c.parentId) : null;
  return p ? `${p.name} › ${c.name}` : c.name;
}
