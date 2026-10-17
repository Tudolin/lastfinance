import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addMonths, endOfMonth, parts, startOfMonth, todaySP } from '@/domain/dates/local-date';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { runTool } from '@/server/agent/tools';
import { inlineStep } from '@/server/jobs/step';
import { exportTransactions, getMonthlyReport, getYearReport } from '@/server/queries/reports';
import { summarize } from '@/server/queries/transactions';
import { runItemSync } from '@/server/services/item-sync';
import { createTestDb } from './helpers/db';

vi.mock('@/server/auth/request', () => ({
  requireUnlocked: async () => ({}),
  requireSession: async () => ({}),
}));

let close: () => Promise<void>;

beforeEach(async () => {
  ({ close } = await createTestDb());
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
  await close();
});

describe('relatórios', () => {
  it('o relatório do mês bate com o resumo e soma as categorias', async () => {
    // mês anterior (fechado): no dia 1º o mês atual ainda não tem gastos
    const month = addMonths(startOfMonth(todaySP()), -1);
    const r = await getMonthlyReport(month);
    const s = await summarize(month, endOfMonth(month), 'accrual');
    expect(r.summary.expenseCents).toBe(s.expenseCents);
    expect(r.summary.leftoverCents).toBe(s.incomeCents - s.expenseCents);
    const catSum = r.categories.reduce((t, c) => t + c.cents, 0);
    expect(catSum).toBe(s.expenseCents);
    expect(r.biggest.length).toBeGreaterThan(0);
    expect(r.biggest[0]!.amountCents).toBeGreaterThanOrEqual(r.biggest.at(-1)!.amountCents);
  });

  it('a visão anual soma os meses', async () => {
    const r = await getYearReport(parts(todaySP()).year);
    expect(r.months.length).toBe(parts(todaySP()).month);
    expect(r.total.expenseCents).toBe(r.months.reduce((t, m) => t + m.expenseCents, 0));
    const c = r.categories[0];
    if (c) expect(c.totalCents).toBe(c.byMonth.reduce((a, b) => a + b, 0));
  });

  it('exporta todas as transações do período com categoria e conta', async () => {
    const from = addMonths(startOfMonth(todaySP()), -1);
    const to = endOfMonth(from);
    const rows = await exportTransactions(from, to, 'accrual');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.date >= from && r.date <= to)).toBe(true);
    expect(rows[0]!.accountName).toBeTruthy();
  });

  it('a ferramenta do assistente devolve o mês em reais', async () => {
    const month = addMonths(startOfMonth(todaySP()), -1).slice(0, 7);
    const r = await runTool('get_month_report', { month });
    expect(r.isError).toBe(false);
    expect(r.content).not.toMatch(/Cents"/);
    expect(JSON.parse(r.content).summary.expense).toBeGreaterThan(0);
  });
});
