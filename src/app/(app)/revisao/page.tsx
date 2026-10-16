import Link from 'next/link';
import { Money } from '@/components/money';
import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle } from '@/components/ui/card';
import { shortDate } from '@/lib/format';
import { getCategories, getReviewItems, getUncategorized } from '@/server/queries/categories';
import { ReviewItem } from './review-client';

export const metadata = { title: 'Revisão' };

export default async function ReviewPage() {
  const [items, uncategorized, categories] = await Promise.all([
    getReviewItems(),
    getUncategorized(),
    getCategories(),
  ]);
  // agrupa por estabelecimento: confirmar um resolve todas as transações dele
  const groups = new Map<string, typeof items>();
  for (const i of items)
    groups.set(i.descriptionNorm, [...(groups.get(i.descriptionNorm) ?? []), i]);
  return (
    <>
      <PageHeader title="Revisão" />
      <p className="-mt-2 text-sm text-ink-2">
        Categorias sugeridas pela IA com pouca confiança. Cada confirmação ou correção vale para o
        estabelecimento inteiro e vira exemplo para as próximas.
      </p>
      <Card className="flex flex-col gap-1">
        <CardTitle className="pb-2">
          Confirme {items.length} {items.length === 1 ? 'transação' : 'transações'}
        </CardTitle>
        {groups.size === 0 ? <p className="text-sm text-ink-2">Nada para revisar.</p> : null}
        {[...groups.values()].map((g) => {
          const first = g[0]!;
          const s = first.suggested as { merchant?: string; confidence?: number };
          return (
            <div
              key={first.descriptionNorm}
              className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0"
            >
              <div className="flex items-start gap-3">
                <Link
                  href={`/transacoes/${first.id}`}
                  className="flex flex-1 flex-col text-ink no-underline"
                >
                  <span className="font-bold">{s.merchant ?? first.description}</span>
                  <span className="text-xs text-ink-2">
                    {first.description} · {g.length}× · {first.institution} · última{' '}
                    {shortDate(first.date)}
                    {s.confidence != null ? ` · confiança ${Math.round(s.confidence * 100)}%` : ''}
                  </span>
                </Link>
                <Money cents={first.amountCents} signed className="font-bold" />
              </div>
              <ReviewItem
                transactionId={first.id}
                reviewId={first.reviewId}
                currentCategoryId={first.categoryId}
                categories={categories}
                kind={first.amountCents > 0 ? 'income' : 'expense'}
              />
            </div>
          );
        })}
      </Card>
      {uncategorized.length ? (
        <Card className="flex flex-col gap-1">
          <CardTitle className="pb-1">Sem categoria</CardTitle>
          <p className="pb-2 text-sm text-ink-2">
            Ainda não passaram pela IA (sem chave configurada, teto de gasto atingido ou aguardando
            o lote).
          </p>
          {uncategorized.map((u) => (
            <div
              key={u.id}
              className="flex flex-col gap-2 border-t border-surface-2 py-3 first:border-t-0"
            >
              <div className="flex items-center gap-3">
                <span className="flex flex-1 flex-col">
                  <span className="font-bold">{u.description}</span>
                  <span className="text-xs text-ink-2">
                    {u.institution} · {shortDate(u.date)}
                  </span>
                </span>
                <Money cents={u.amountCents} signed className="font-bold" />
              </div>
              <ReviewItem
                transactionId={u.id}
                currentCategoryId={null}
                categories={categories}
                kind={u.amountCents > 0 ? 'income' : 'expense'}
              />
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}
