import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { addMonths, endOfMonth, startOfMonth, todaySP } from '@/domain/dates/local-date';
import {
  categoryBreakdown,
  getCategories,
  getCategorySuggestions,
} from '@/server/queries/categories';
import { CategoryRowActions, NewCategoryForm, SuggestionActions } from './categories-client';

export const metadata = { title: 'Categorias' };

export default async function CategoriesPage() {
  const today = todaySP();
  const from = addMonths(startOfMonth(today), -3);
  const [cats, suggestions, breakdown] = await Promise.all([
    getCategories(true),
    getCategorySuggestions(),
    categoryBreakdown(from, endOfMonth(today), 'accrual'),
  ]);
  const spent = new Map(breakdown.map((b) => [b.categoryId, b]));
  const roots = cats.filter((c) => !c.parentId);
  return (
    <>
      <PageHeader title="Categorias" />
      <p className="-mt-2 text-sm text-ink-2">
        Gasto dos últimos 3 meses por categoria (competência). Regras automáticas ficam em{' '}
        <Link href="/regras">Regras</Link>; o que precisa da sua confirmação, em{' '}
        <Link href="/revisao">Revisão</Link>.
      </p>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="flex flex-col gap-1 py-2 lg:col-span-2">
          {(['expense', 'income'] as const).map((kind) => (
            <div key={kind} className="flex flex-col">
              <h2 className="pt-3 pb-1 text-xs font-extrabold tracking-wider text-ink-2 uppercase">
                {kind === 'expense' ? 'Despesas' : 'Receitas'}
              </h2>
              {roots
                .filter((r) => r.kind === kind)
                .map((r) => {
                  const kids = cats.filter((c) => c.parentId === r.id);
                  const total = [r, ...kids].reduce((s, c) => s + (spent.get(c.id)?.cents ?? 0), 0);
                  return (
                    <div key={r.id} className="border-t border-surface-2 py-2 first:border-t-0">
                      <div
                        className={`flex items-center gap-2 ${r.archivedAt ? 'opacity-50' : ''}`}
                      >
                        <span
                          className="size-3 rounded-full"
                          style={{ background: r.color ?? '#94a3b8' }}
                          aria-hidden="true"
                        />
                        <Link
                          href={`/transacoes?category=${r.id}`}
                          className="flex-1 font-bold text-ink no-underline"
                        >
                          {r.name}
                        </Link>
                        {total ? <Money cents={total} className="text-sm font-bold" /> : null}
                        <CategoryRowActions id={r.id} name={r.name} archived={!!r.archivedAt} />
                      </div>
                      {kids.map((c) => (
                        <div
                          key={c.id}
                          className={`flex items-center gap-2 pl-5 text-sm ${c.archivedAt ? 'opacity-50' : ''}`}
                        >
                          <Link
                            href={`/transacoes?category=${c.id}`}
                            className="flex-1 text-ink-2 no-underline"
                          >
                            {c.name}
                          </Link>
                          {spent.get(c.id)?.cents ? (
                            <Money cents={spent.get(c.id)!.cents} className="text-ink-2" />
                          ) : null}
                          <CategoryRowActions id={c.id} name={c.name} archived={!!c.archivedAt} />
                        </div>
                      ))}
                    </div>
                  );
                })}
            </div>
          ))}
        </Card>
        <div className="flex flex-col gap-5">
          <Card className="flex flex-col gap-3">
            <CardTitle>Nova categoria</CardTitle>
            <NewCategoryForm
              parents={roots
                .filter((r) => !r.archivedAt)
                .map((r) => ({ id: r.id, name: r.name, kind: r.kind }))}
            />
          </Card>
          {suggestions.length ? (
            <Card className="flex flex-col gap-3">
              <CardTitle>Sugeridas pela IA</CardTitle>
              <p className="text-sm text-ink-2">
                A IA só sugere; nada é criado sem a sua aprovação.
              </p>
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 border-t border-surface-2 pt-2 first:border-t-0"
                >
                  <span className="flex flex-1 flex-col">
                    <strong>{s.name}</strong>
                    <span className="text-xs text-ink-2">
                      ex.: {s.examples.slice(0, 3).join(', ')}
                    </span>
                  </span>
                  <SuggestionActions id={s.id} />
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
