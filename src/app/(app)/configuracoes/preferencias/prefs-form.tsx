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
      {state && !state.ok ? <FormError message={state.error} /> : null}
      {state?.ok ? <Notice tone="success">Salvo.</Notice> : null}
      <Button type="submit" disabled={pending}>
        Salvar preferências
      </Button>
    </form>
  );
}
