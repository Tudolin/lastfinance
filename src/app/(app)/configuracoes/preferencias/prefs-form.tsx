'use client';

import { useActionState } from 'react';
import { FormError } from '@/components/auth/form-error';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';
import { updatePreferencesAction } from '../actions';

export function PreferencesForm(p: {
  savingsGoalPct: number;
  aiMonthlyBudgetUsd: number;
  aiReviewThreshold: number;
  reserveMinCents: number;
  forecastVariableMode: 'avg3' | 'avg6' | 'budget';
}) {
  const [state, action, pending] = useActionState(updatePreferencesAction, undefined);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Meta de taxa de poupança (%)" htmlFor="savingsGoalPct">
        <Input
          id="savingsGoalPct"
          name="savingsGoalPct"
          type="number"
          min={0}
          max={100}
          defaultValue={p.savingsGoalPct}
        />
      </Field>
      <Field
        label="Teto de gasto mensal com IA (US$)"
        htmlFor="aiMonthlyBudgetUsd"
        hint="Ao atingir, a categorização segue só com regras e o histórico de estabelecimentos."
      >
        <Input
          id="aiMonthlyBudgetUsd"
          name="aiMonthlyBudgetUsd"
          type="number"
          min={0}
          max={1000}
          step="0.5"
          defaultValue={p.aiMonthlyBudgetUsd}
        />
      </Field>
      <Field
        label="Revisar sugestões da IA abaixo de (% de confiança)"
        htmlFor="aiReviewThresholdPct"
      >
        <Input
          id="aiReviewThresholdPct"
          name="aiReviewThresholdPct"
          type="number"
          min={0}
          max={100}
          defaultValue={Math.round(p.aiReviewThreshold * 100)}
        />
      </Field>
      <Field
        label="Reserva mínima (R$)"
        htmlFor="reserveMin"
        hint="“Posso gastar?” avisa quando o saldo previsto fica abaixo deste valor."
      >
        <Input
          id="reserveMin"
          name="reserveMin"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          defaultValue={(p.reserveMinCents / 100).toFixed(2)}
        />
      </Field>
      <Field label="Gasto variável na previsão" htmlFor="forecastVariableMode">
        <select
          id="forecastVariableMode"
          name="forecastVariableMode"
          defaultValue={p.forecastVariableMode}
          className="min-h-12 rounded-xl border border-border-strong bg-surface px-3 text-[15px] font-semibold text-ink"
        >
          <option value="avg3">Média dos últimos 3 meses</option>
          <option value="avg6">Média dos últimos 6 meses</option>
          <option value="budget">Pelos orçamentos do mês</option>
        </select>
      </Field>
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <Notice tone="success">Salvo.</Notice> : null}
      <Button type="submit" disabled={pending}>
        Salvar preferências
      </Button>
    </form>
  );
}
