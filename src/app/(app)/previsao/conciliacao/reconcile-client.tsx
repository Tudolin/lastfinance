'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Money } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatBR, type LocalDate } from '@/domain/dates/local-date';
import {
  manualMatchAction,
  matchCandidatesAction,
  overrideEntryAction,
  setEntryStatusAction,
  unmatchAction,
} from '../actions';

type Candidate = Awaited<ReturnType<typeof matchCandidatesAction>>[number];

export function EntryActions({
  entryId,
  matchId,
  status,
  expectedCents,
}: {
  entryId: string;
  matchId: string | null;
  status: string;
  expectedCents: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'none' | 'match' | 'adjust'>('none');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [amount, setAmount] = useState((expectedCents / 100).toFixed(2));
  const [error, setError] = useState<string>();
  const run = (fn: () => Promise<{ ok: boolean; error?: string } | unknown>) =>
    start(async () => {
      const r = (await fn()) as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) setError(r.error);
      else {
        setMode('none');
        setError(undefined);
      }
      router.refresh();
    });

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {matchId ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => unmatchAction(matchId))}
          >
            Desfazer par
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => {
                setMode(mode === 'match' ? 'none' : 'match');
                if (!candidates)
                  start(async () => setCandidates(await matchCandidatesAction(entryId)));
              }}
            >
              Casar à mão
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setMode(mode === 'adjust' ? 'none' : 'adjust')}
            >
              Ajustar valor
            </Button>
            {status === 'cancelado' ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => setEntryStatusAction(entryId, 'previsto'))}
              >
                Restaurar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => setEntryStatusAction(entryId, 'cancelado'))}
              >
                Cancelar
              </Button>
            )}
          </>
        )}
      </div>
      {mode === 'adjust' ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => overrideEntryAction(entryId, Number(amount)));
          }}
        >
          <label className="sr-only" htmlFor={`adj-${entryId}`}>
            Novo valor (R$)
          </label>
          <Input
            id={`adj-${entryId}`}
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="min-h-10 w-36"
          />
          <Button size="sm" type="submit" disabled={pending}>
            Salvar
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => overrideEntryAction(entryId, null))}
          >
            Voltar ao calculado
          </Button>
        </form>
      ) : null}
      {mode === 'match' ? (
        <ul className="flex w-full max-w-md flex-col gap-1 rounded-xl border border-border p-2 text-sm">
          {candidates == null ? (
            <li className="text-ink-2">Buscando transações…</li>
          ) : candidates.length === 0 ? (
            <li className="text-ink-2">Nenhuma transação livre perto da data.</li>
          ) : (
            candidates.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={pending}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
                  onClick={() => run(() => manualMatchAction(entryId, c.id))}
                >
                  <span className="w-12 text-xs text-ink-2">
                    {formatBR(c.date as LocalDate).slice(0, 5)}
                  </span>
                  <span className="flex-1 truncate font-semibold">{c.description}</span>
                  <Money cents={c.amountCents} signed tone="auto" />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {error ? <span className="text-xs font-bold text-danger-ink">{error}</span> : null}
    </div>
  );
}
