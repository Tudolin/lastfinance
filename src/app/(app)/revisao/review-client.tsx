'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  confirmSuggestionAction,
  dismissReviewAction,
  setTransactionCategoryAction,
} from '@/app/(app)/categorias/actions';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';

export function ReviewItem({
  transactionId,
  reviewId,
  currentCategoryId,
  categories,
  kind,
}: {
  transactionId: string;
  reviewId?: string;
  currentCategoryId: string | null;
  categories: CategoryOption[];
  kind: 'expense' | 'income';
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentCategoryId ?? '');
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  if (done) return <span className="text-sm font-bold text-primary-on-soft">Feito</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CategorySelect
        aria-label="Categoria"
        categories={categories}
        kind={kind}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="min-h-10 min-w-0 flex-1 text-sm"
      />
      {currentCategoryId && value === currentCategoryId ? (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(
              async () => (
                await confirmSuggestionAction(transactionId),
                setDone(true),
                router.refresh()
              ),
            )
          }
        >
          Confirmar
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={pending || !value}
          onClick={() =>
            start(
              async () => (
                await setTransactionCategoryAction(transactionId, value, {
                  createRule: true,
                  applyToSimilar: true,
                }),
                setDone(true),
                router.refresh()
              ),
            )
          }
        >
          Salvar e criar regra
        </Button>
      )}
      {reviewId ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(
              async () => (await dismissReviewAction(reviewId), setDone(true), router.refresh()),
            )
          }
        >
          Ignorar
        </Button>
      ) : null}
    </div>
  );
}
