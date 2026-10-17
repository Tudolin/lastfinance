import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, todaySP } from '@/domain/dates/local-date';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { runTool } from '@/server/agent/tools';
import { schema, type Db } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { getSavingsView, getSubscriptionsView, getWealthView } from '@/server/queries/wealth';
import { runItemSync } from '@/server/services/item-sync';
import { currentRates, refreshRates, setRatesFetcherForTests } from '@/server/services/rates';
import { computeNetWorth } from '@/server/services/wealth';
import { createTestDb } from './helpers/db';

vi.mock('@/server/auth/request', () => ({
  requireUnlocked: async () => ({}),
  requireSession: async () => ({}),
}));

let db: Db;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const pluggy = new FakePluggy(todaySP());
  pluggy.seedInstitution('itau');
  pluggy.seedInstitution('nubank');
  setPluggyForTests(pluggy);
  setAiForTests(new FakeAiGateway());
  for (const id of ['fake-item-itau', 'fake-item-nubank'])
    await runItemSync(inlineStep, {
      pluggyItemId: id,
      mode: 'backfill',
      trigger: 'manual',
      runId: id,
    });
});

afterEach(async () => {
  setPluggyForTests(undefined);
  setAiForTests(undefined);
  setRatesFetcherForTests(undefined);
  await close();
});

describe('patrimônio', () => {
  it('soma contas e investimentos e desconta a fatura aberta', async () => {
    const nw = await computeNetWorth();
    expect(nw.investmentsCents).toBe(2176000);
    expect(nw.netCents).toBe(nw.cashCents + nw.investmentsCents - nw.cardDebtCents);
    expect(nw.breakdown.investments[0]?.name).toBe('Caixinha Reserva de emergência');
  });

  it('grava um retrato por dia e mostra a variação', async () => {
    const today = todaySP();
    await db.insert(schema.netWorthSnapshot).values({
      date: addDays(today, -40),
      cashCents: 0,
      investmentsCents: 0,
      cardDebtCents: 0,
      netCents: 100000,
    });
    const v = await getWealthView();
    await getWealthView(); // idempotente no mesmo dia
    expect(v.history.map((h) => h.date)).toEqual([addDays(today, -40), today]);
    expect(v.change30d).toEqual({ since: addDays(today, -40), cents: v.now.netCents - 100000 });
  });
});

describe('caixinhas e metas', () => {
  it('meta vinculada acompanha o saldo do investimento; manual usa o valor informado', async () => {
    const [inv] = await db.select().from(schema.investment);
    await db.insert(schema.goal).values([
      { name: 'Reserva', targetCents: 3000000, investmentId: inv!.id },
      { name: 'Viagem', targetCents: 500000, manualSavedCents: 500000 },
    ]);
    const v = await getSavingsView();
    const reserva = v.goals.find((g) => g.name === 'Reserva')!;
    expect(reserva.progress.savedCents).toBe(2176000);
    expect(reserva.investmentName).toBe('Caixinha Reserva de emergência');
    expect(v.goals.find((g) => g.name === 'Viagem')!.progress.status).toBe('done');
    expect(v.emergency.targetMonths).toBe(6);
    expect(v.emergency.liquidCents).toBeGreaterThanOrEqual(v.investedCents);
  });

  it('a ferramenta do assistente devolve metas e reserva em reais', async () => {
    const r = await runTool('get_savings_and_goals', {});
    expect(r.isError).toBe(false);
    const data = JSON.parse(r.content);
    expect(data.invested).toBe(21760);
    expect(data.investments[0].name).toBe('Caixinha Reserva de emergência');
  });

  it('simula rendimento com CDI informado e calcula o aporte para um alvo', async () => {
    const r = await runTool('simulate_savings', {
      initial: 1000,
      monthly: 500,
      months: 24,
      cdiAnnualPct: 14,
      target: 20000,
    });
    const data = JSON.parse(r.content);
    expect(data.invested).toBe(13000);
    expect(data.net).toBeGreaterThan(13000);
    expect(data.requiredMonthly).toBeGreaterThan(500);
  });

  it('sem CDI gravado e sem taxa informada, pede a taxa', async () => {
    const r = await runTool('simulate_savings', { months: 12, monthly: 100 });
    expect(JSON.parse(r.content).error).toMatch(/cdiAnnualPct/);
  });
});

describe('taxas do Banco Central', () => {
  it('grava as séries e calcula o CDI anual; falha de uma série não derruba as outras', async () => {
    const urls: string[] = [];
    setRatesFetcherForTests(async (url) => {
      urls.push(url);
      if (url.includes('sgs.11/')) return { ok: false, status: 503, json: async () => [] };
      const valor = url.includes('sgs.432/') ? '15.00' : '0.055131';
      return {
        ok: true,
        status: 200,
        json: async () => [
          { data: '15/10/2026', valor },
          { data: '16/10/2026', valor },
        ],
      };
    });
    const out = await refreshRates('2026-10-17' as never);
    expect(out).toMatchObject({ cdi: 2, selicTarget: 2, selic: 'erro: HTTP 503' });
    expect(urls[0]).toContain('dataInicial=02/10/2026&dataFinal=17/10/2026');
    await refreshRates('2026-10-17' as never); // idempotente
    const rows = await db
      .select()
      .from(schema.rateHistory)
      .where(eq(schema.rateHistory.series, '12'));
    expect(rows).toHaveLength(2);
    const r = await currentRates();
    expect(r.cdiDate).toBe('2026-10-16');
    expect(r.cdiAnnual).toBeCloseTo(0.149, 3);
    expect(r.selicAnnual).toBeCloseTo(0.15, 6);
  });
});

describe('assinaturas', () => {
  it('soma as recorrências marcadas como assinatura', async () => {
    const today = todaySP();
    await db.insert(schema.recurringItem).values([
      {
        name: 'Streaming',
        direction: 'out',
        descriptionNorm: 'STREAMING',
        amountCents: 3990,
        periodicity: 'monthly',
        anchorDay: 5,
        startDate: addDays(today, -200),
        status: 'confirmed',
        isSubscription: true,
        lastAmountCents: 4490,
        lastSeenDate: addDays(today, -10),
      },
      {
        name: 'Aluguel',
        direction: 'out',
        descriptionNorm: 'ALUGUEL XYZ',
        amountCents: 200000,
        periodicity: 'monthly',
        anchorDay: 10,
        startDate: addDays(today, -200),
        status: 'confirmed',
      },
    ]);
    const v = await getSubscriptionsView();
    const s = v.items.find((i) => i.name === 'Streaming')!;
    expect(s.priceChange).toEqual({ fromCents: 3990, toCents: 4490 });
    expect(v.monthlyCents).toBeGreaterThanOrEqual(4490);
    expect(v.others.map((o) => o.name)).toContain('Aluguel');
  });
});
