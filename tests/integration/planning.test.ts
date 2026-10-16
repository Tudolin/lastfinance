import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { project } from '@/domain/forecast/project';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { schema, type Db } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { runItemSync } from '@/server/services/item-sync';
import {
  buildProjectionContext,
  reconcileForecast,
  refreshPlanning,
} from '@/server/services/planning';
import { createTestDb } from './helpers/db';

const {
  account,
  incomeSource,
  incomeSalaryHistory,
  recurringItem,
  forecastEntry,
  forecastMatch,
  taxTable,
} = schema;

let db: Db;
let close: () => Promise<void>;
let run = 0;
const today = todaySP();

const sync = (id: string) =>
  runItemSync(inlineStep, {
    pluggyItemId: id,
    mode: 'backfill',
    trigger: 'manual',
    runId: `plan-${++run}`,
  });

async function checkingOf(name: RegExp) {
  const rows = await db.select().from(account).where(eq(account.kind, 'checking'));
  return rows.find((r) => name.test(r.name)) ?? rows[0]!;
}

async function addSalary() {
  const itau = await checkingOf(/ita/i);
  const [src] = await db
    .insert(incomeSource)
    .values({
      name: 'ACME',
      type: 'other',
      employerName: 'ACME',
      matchPattern: 'SALARIO ACME',
      accountId: itau.id,
      startDate: '2024-01-01',
      paymentRule: {
        parts: [{ pct: 100, rule: { type: 'nth_business_day', n: 5 }, monthOffset: 0 }],
        saturdayIsBusinessDay: false,
      },
    })
    .returning();
  await db
    .insert(incomeSalaryHistory)
    .values({ incomeSourceId: src!.id, grossCents: 612730, validFrom: '2024-01-01' });
  return src!;
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  const pluggy = new FakePluggy(today);
  pluggy.seedInstitution('itau');
  pluggy.seedInstitution('nubank');
  setPluggyForTests(pluggy);
  setAiForTests(new FakeAiGateway());
  await sync('fake-item-itau');
  await sync('fake-item-nubank');
});
afterEach(async () => {
  setPluggyForTests(undefined);
  setAiForTests(undefined);
  await close();
});

describe('Planejado × Realizado', () => {
  it('semeia as tabelas fiscais e sugere recorrências depois do sync', async () => {
    expect((await db.select().from(taxTable)).length).toBeGreaterThanOrEqual(12);
    const items = await db.select().from(recurringItem);
    const names = items.map((i) => i.descriptionNorm);
    expect(names).toEqual(
      expect.arrayContaining(['PIX ENVIADO IMOBILIARIA BOA VISTA', 'DEB AUT VIVO FIBRA']),
    );
    expect(items.every((i) => i.status === 'suggested')).toBe(true);
    const rent = items.find((i) => i.descriptionNorm?.includes('IMOBILIARIA'))!;
    expect(rent).toMatchObject({
      periodicity: 'monthly',
      amountCents: 210000,
      nature: 'fixed',
      direction: 'out',
    });
  });

  it('salário previsto concilia com o real, sem contar duas vezes, e é idempotente', async () => {
    const src = await addSalary();
    const first = await refreshPlanning(today);
    expect(first.matched).toBeGreaterThanOrEqual(2);

    const entries = await db.select().from(forecastEntry).where(eq(forecastEntry.sourceId, src.id));
    const past = entries.filter((e) => e.expectedDate < addDays(today, -10));
    expect(past.length).toBeGreaterThanOrEqual(2);
    expect(past.every((e) => e.status === 'realizado')).toBe(true);
    expect(entries.some((e) => e.expectedDate > today && e.status === 'previsto')).toBe(true);

    const matches = await db.select().from(forecastMatch).where(isNull(forecastMatch.unmatchedAt));
    expect(new Set(matches.map((m) => m.transactionId)).size).toBe(matches.length);
    expect(matches.every((m) => m.deltaCents === 0)).toBe(true);

    const again = await refreshPlanning(today);
    expect(again.matched).toBe(0);
    const entries2 = await db
      .select()
      .from(forecastEntry)
      .where(eq(forecastEntry.sourceId, src.id));
    expect(entries2.length).toBe(entries.length);
  });

  it('recorrência confirmada vira previsto; desfazer um par não volta a casar', async () => {
    const [rent] = await db
      .update(recurringItem)
      .set({ status: 'confirmed' })
      .where(sql`${recurringItem.descriptionNorm} like '%IMOBILIARIA%'`)
      .returning();
    await refreshPlanning(today);
    const entries = await db
      .select()
      .from(forecastEntry)
      .where(eq(forecastEntry.sourceId, rent!.id));
    expect(entries.length).toBeGreaterThan(10);
    const [m] = await db
      .select()
      .from(forecastMatch)
      .innerJoin(forecastEntry, eq(forecastMatch.forecastEntryId, forecastEntry.id))
      .where(eq(forecastEntry.sourceId, rent!.id))
      .limit(1);
    expect(m).toBeDefined();
    await db
      .update(forecastMatch)
      .set({ unmatchedAt: new Date() })
      .where(eq(forecastMatch.id, m!.forecast_match.id));
    await reconcileForecast(today);
    const active = await db
      .select()
      .from(forecastMatch)
      .where(
        and(
          eq(forecastMatch.transactionId, m!.forecast_match.transactionId),
          isNull(forecastMatch.unmatchedAt),
        ),
      );
    expect(active).toHaveLength(0);
  });

  it('projeção parte do saldo das contas e inclui o próximo salário e as faturas', async () => {
    await addSalary();
    await refreshPlanning(today);
    const ctx = await buildProjectionContext(60, today);
    const cash = (await db.select().from(account)).filter((a) => a.kind !== 'credit_card');
    expect(ctx.input.startBalance).toBe(cash.reduce((s, a) => s + a.balanceCents, 0));
    expect(ctx.nextIncome).not.toBeNull();
    expect(ctx.input.events.some((e) => e.kind === 'income' && e.cents === 612730)).toBe(true);
    expect(ctx.input.events.some((e) => e.kind === 'bill')).toBe(true);
    expect(ctx.variableMonthlyCents).toBeGreaterThan(0);
    const p = project(ctx.input);
    expect(p.days).toHaveLength(61);
    expect(p.days[0]!.date).toBe(today);
    expect(p.days.every((d) => d.low <= d.balance && d.balance <= d.high)).toBe(true);
  });

  it('parcelas futuras do cartão viram previstos e somem quando deixam de existir', async () => {
    await refreshPlanning(today);
    const inst = await db
      .select()
      .from(forecastEntry)
      .where(eq(forecastEntry.sourceType, 'installment'));
    expect(inst.length).toBeGreaterThan(0);
    expect(inst.every((e) => (e.cashDate as LocalDate) > today)).toBe(true);
  });
});
