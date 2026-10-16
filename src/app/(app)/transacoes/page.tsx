import { Search } from 'lucide-react';
import Link from 'next/link';
import { CategorySelect, labelFor } from '@/components/categories/category-select';
import { PageHeader } from '@/components/shell/page-header';
import { getCategories } from '@/server/queries/categories';
import { BasisToggle } from '@/components/tx/basis-toggle';
import { TransactionRow } from '@/components/tx/transaction-row';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { TX_KINDS, TX_KIND_LABEL } from '@/domain/classification/types';
import { weekdayDate } from '@/lib/format';
import type { LocalDate } from '@/domain/dates/local-date';
import {
  listAccountsForFilter,
  listTransactions,
  transactionFiltersSchema,
} from '@/server/queries/transactions';

export const metadata = { title: 'Transações' };

type SP = Record<string, string | string[] | undefined>;

function qs(sp: SP, patch: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch }))
    if (typeof v === 'string' && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `/transacoes?${s}` : '/transacoes';
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const parsed = transactionFiltersSchema.safeParse(
    Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === 'string' && v !== '')),
  );
  const f = parsed.success ? parsed.data : transactionFiltersSchema.parse({});
  const [{ rows, hasMore }, accounts, categories] = await Promise.all([
    listTransactions(f),
    listAccountsForFilter(),
    getCategories(),
  ]);

  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.date, [...(groups.get(r.date) ?? []), r]);

  const selectCls =
    'min-h-10 rounded-full border border-border-strong bg-surface px-3 text-[13px] font-bold text-ink-2';
  return (
    <>
      <PageHeader title="Transações">
        <BasisToggle
          basis={f.basis}
          hrefFor={(b) => qs(sp, { basis: b === 'cash' ? undefined : 'accrual', page: undefined })}
        />
      </PageHeader>

      <form method="get" className="flex flex-col gap-3" role="search">
        {f.basis === 'accrual' ? <input type="hidden" name="basis" value="accrual" /> : null}
        <div className="flex min-h-12 items-center gap-2.5 rounded-xl border border-border-strong bg-surface px-3.5">
          <Search className="size-[18px] text-ink-2" aria-hidden="true" />
          <label htmlFor="q" className="sr-only">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="Buscar por descrição, valor ou #tag"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="account">
            Conta
          </label>
          <select id="account" name="account" defaultValue={f.account ?? ''} className={selectCls}>
            <option value="">Todas as contas</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.institution} · {a.name}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="kind">
            Tipo
          </label>
          <select id="kind" name="kind" defaultValue={f.kind ?? ''} className={selectCls}>
            <option value="">Todos os tipos</option>
            {TX_KINDS.map((k) => (
              <option key={k} value={k}>
                {TX_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="category">
            Categoria
          </label>
          <CategorySelect
            id="category"
            name="category"
            categories={categories}
            emptyLabel="Todas as categorias"
            defaultValue={f.category ?? ''}
            className={selectCls}
          />
          <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
            De
            <input type="date" name="from" defaultValue={f.from} className={selectCls} />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
            Até
            <input type="date" name="to" defaultValue={f.to} className={selectCls} />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
            Valor de
            <input
              type="number"
              name="min"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={f.min}
              className={`${selectCls} w-24`}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
            até
            <input
              type="number"
              name="max"
              min="0"
              step="0.01"
              inputMode="decimal"
              defaultValue={f.max}
              className={`${selectCls} w-24`}
            />
          </label>
          <button type="submit" className={buttonVariants({ variant: 'dark', size: 'sm' })}>
            Filtrar
          </button>
          <Link href="/transacoes" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Limpar
          </Link>
        </div>
      </form>

      {rows.length === 0 ? (
        <Card className="text-center text-ink-2">
          Nenhuma transação encontrada com esses filtros.
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          {[...groups.entries()].map(([date, items]) => (
            <Card key={date} aria-label={weekdayDate(date as LocalDate)} className="px-4 py-1">
              <h2 className="pt-3 pb-1.5 text-[13px] font-extrabold text-ink-2">
                {weekdayDate(date as LocalDate)}
              </h2>
              {items.map((t) => (
                <TransactionRow
                  key={t.id}
                  t={{ ...t, categoryLabel: labelFor(t.categoryId, categories) }}
                />
              ))}
            </Card>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        {f.page > 1 ? (
          <Link
            href={qs(sp, { page: String(f.page - 1) })}
            className={buttonVariants({ variant: 'outline' })}
          >
            Anteriores
          </Link>
        ) : (
          <span />
        )}
        {hasMore ? (
          <Link
            href={qs(sp, { page: String(f.page + 1) })}
            className={buttonVariants({ variant: 'outline' })}
          >
            Mais antigas
          </Link>
        ) : null}
      </div>
    </>
  );
}
