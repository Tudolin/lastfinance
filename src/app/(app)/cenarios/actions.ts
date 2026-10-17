'use server';

import { z } from 'zod';
import { scenarioChangeSchema } from '@/domain/scenarios/changes';
import { simulateScenario } from '@/server/queries/scenarios';

export type ScenarioResult = Awaited<ReturnType<typeof simulateScenario>>;

/** Impacto de mudanças hipotéticas na previsão de caixa (nada é gravado). */
export async function simulateScenarioAction(
  changes: unknown,
): Promise<{ ok: true; data: ScenarioResult } | { ok: false; error: string }> {
  const p = z.array(scenarioChangeSchema).min(1).max(10).safeParse(changes);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Dados inválidos.' };
  return { ok: true, data: await simulateScenario(p.data) };
}
