'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setSplitsAction, setTransactionCategoryAction } from '@/app/(app)/categorias/actions';
import { FormError } from '@/components/auth/form-error';
import { CategorySelect, type CategoryOption } from '@/components/categories/category-select';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Label } from '@/components/ui/input';

export function CategoryEditor({
  transactionId,
  categoryId,
  categories,
  kind,
  sourceLabel,
}: {
  transactionId: string;
  categoryId: string | null;
  categories: CategoryOption[];
  kind: 'expense' | 'income';
  sourceLabel: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(categoryId ?? '');
  const [createRule, setCreateRule] = useState(true);
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const [msg, setMsg] = useState<string>();
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await setTransactionCategoryAction(transactionId, value || null, {
        createRule,
        applyToSimilar,
      });
      if (r.ok) {
        const parts = ['Categoria salva.'];
        if (r.data?.similar) parts.push(`${r.data.similar} transações parecidas atualizadas.`);
        if (r.data?.ruleId) parts.push('Regra criada para as próximas.');
        setMsg(parts.join(' '));
        router.refresh();
      }
    });
  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor="category">Categoria</Label>
      <CategorySelect
        id="category"
        categories={categories}
        kind={kind}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      {sourceLabel ? <span className="text-xs text-ink-2">{sourceLabel}</span> : null}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={applyToSimilar}
          onChange={(e) => setApplyToSimilar(e.target.checked)}
          className="size-4"
        />
        Aplicar às outras transações deste estabelecimento
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={createRule}
          onChange={(e) => setCreateRule(e.target.checked)}
          className="size-4"
        />
        Criar regra para as próximas
      </label>
      {msg ? <Notice tone="success">{msg}</Notice> : null}
      <Button onClick={save} disabled={pending}>
        {pending ? 'Salvando…' : 'Salvar categoria'}
      </Button>
    </div>
  );
}

type Part = { categoryId: string; amount: string };

export function SplitEditor({
  transactionId,
  totalCents,
  initial,
  categories,
  kind,
}: {
  transactionId: string;
  totalCents: number;
  initial: { categoryId: string | null; amountCents: number }[];
  categories: CategoryOption[];
  kind: 'expense' | 'income';
}) {
  const router = useRouter();
  const total = Math.abs(totalCents) / 100;
  const [parts, setParts] = useState<Part[]>(
    initial.length
      ? initial.map((p) => ({
          categoryId: p.categoryId ?? '',
          amount: (Math.abs(p.amountCents) / 100).toFixed(2),
        }))
      : [],
  );
  const [error, setError] = useState<string>();
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const sum = parts.reduce((s, p) => s + (Number(p.amount.replace(',', '.')) || 0), 0);
  const save = (next: Part[]) =>
    start(async () => {
      setError(undefined);
      setOk(false);
      const r = await setSplitsAction(
        transactionId,
        next.map((p) => ({ categoryId: p.categoryId, amount: Number(p.amount.replace(',', '.')) })),
      );
      if (!r.ok) setError(r.error);
      else {
        setOk(true);
        router.refresh();
      }
    });
  if (parts.length === 0) {
    return (
      <Button
        variant="outline"
        onClick={() =>
          setParts([
            { categoryId: '', amount: total.toFixed(2) },
            { categoryId: '', amount: '0.00' },
          ])
        }
      >
        <Plus className="size-4" aria-hidden="true" />
        Dividir em várias categorias
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {parts.map((p, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <CategorySelect
            aria-label={`Categoria da parte ${i + 1}`}
            categories={categories}
            kind={kind}
            value={p.categoryId}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)))
            }
            className="min-w-0 flex-1"
          />
          <input
            aria-label={`Valor da parte ${i + 1}`}
            inputMode="decimal"
            value={p.amount}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
            }
            className="min-h-12 w-28 rounded-xl border border-border-strong bg-surface px-3 text-right font-semibold"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remover parte ${i + 1}`}
            onClick={() => setParts(parts.filter((_, j) => j !== i))}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
      <span
        className={`text-sm font-bold ${Math.abs(sum - total) < 0.005 ? 'text-primary-on-soft' : 'text-warn-ink dark:text-warn'}`}
      >
        Soma {sum.toFixed(2).replace('.', ',')} de {total.toFixed(2).replace('.', ',')}
      </span>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setParts([...parts, { categoryId: '', amount: '0.00' }])}
        >
          <Plus className="size-4" aria-hidden="true" />
          Parte
        </Button>
        <Button size="sm" disabled={pending} onClick={() => save(parts)}>
          Salvar divisão
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setParts([]);
            save([]);
          }}
        >
          Desfazer divisão
        </Button>
      </div>
      <FormError message={error} />
      {ok ? <Notice tone="success">Divisão salva.</Notice> : null}
    </div>
  );
}
