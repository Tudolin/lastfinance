import { PageHeader } from '@/components/shell/page-header';
import { Card, CardTitle, Notice } from '@/components/ui/card';
import { startOfMonth, todaySP } from '@/domain/dates/local-date';
import { env } from '@/lib/env';
import { requireUnlocked } from '@/server/auth/request';
import { aiUsageSummary } from '@/server/queries/categories';
import { PreferencesForm } from './prefs-form';

export const metadata = { title: 'Preferências' };

export default async function PreferencesPage() {
  const s = await requireUnlocked();
  const usage = await aiUsageSummary(new Date(`${startOfMonth(todaySP())}T03:00:00Z`));
  const e = env();
  const aiOn = e.AI_FAKE || !!e.ANTHROPIC_API_KEY;
  const usedPct =
    s.settings.aiMonthlyBudgetUsd > 0
      ? Math.min(100, Math.round((usage.costUsd / s.settings.aiMonthlyBudgetUsd) * 100))
      : 100;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <PageHeader title="Preferências" />
      <Card className="flex flex-col gap-3">
        <CardTitle>IA (Claude Haiku)</CardTitle>
        {aiOn ? (
          <p className="text-sm text-ink-2">
            Modelo: <strong>{e.AI_FAKE ? 'simulado (AI_FAKE)' : e.AI_MODEL}</strong>. Só descrições
            normalizadas de estabelecimentos e valores típicos são enviados — nunca CPF, número de
            conta ou nomes de contrapartes.
          </p>
        ) : (
          <Notice tone="warn">
            Sem ANTHROPIC_API_KEY: a categorização usa só regras e o histórico de estabelecimentos.
          </Notice>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-sm">
            Gasto neste mês: <strong>US$ {usage.costUsd.toFixed(4)}</strong> de US${' '}
            {s.settings.aiMonthlyBudgetUsd.toFixed(2)} · {usage.calls} chamadas ·{' '}
            {(usage.inputTokens + usage.outputTokens).toLocaleString('pt-BR')} tokens
          </span>
          <div className="h-2 rounded bg-track" aria-hidden="true">
            <div
              className={`h-2 rounded ${usedPct >= 80 ? 'bg-warn' : 'bg-[#0b6e55]'}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          {usedPct >= 80 ? (
            <span className="text-xs font-bold text-warn-ink dark:text-warn">
              Perto do teto mensal.
            </span>
          ) : null}
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <CardTitle>Metas, limites e previsão</CardTitle>
        <PreferencesForm
          savingsGoalPct={s.settings.savingsGoalPct}
          aiMonthlyBudgetUsd={s.settings.aiMonthlyBudgetUsd}
          aiReviewThreshold={s.settings.aiReviewThreshold}
          reserveMinCents={s.settings.reserveMinCents}
          forecastVariableMode={s.settings.forecastVariableMode}
        />
      </Card>
    </div>
  );
}
