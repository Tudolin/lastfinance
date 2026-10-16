import { and, eq, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todaySP } from '@/domain/dates/local-date';
import { setAiForTests } from '@/server/adapters/ai/client';
import { FakeAiGateway } from '@/server/adapters/ai/fake';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { schema, type Db } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { categoryBySlug } from '@/server/services/categories';
import {
  applyRuleRetroactively,
  CATEGORIZE_CONFIG,
  categorizePending,
  correctCategory,
} from '@/server/services/categorize';
import { runItemSync } from '@/server/services/item-sync';
import { postprocess } from '@/server/services/postprocess';
import { createTestDb } from './helpers/db';

const {
  transaction: tx,
  merchant,
  reviewQueue,
  aiUsageLog,
  aiBatchJob,
  categorizationRule,
  appUser,
} = schema;

let db: Db;
let close: () => Promise<void>;
let pluggy: FakePluggy;
let ai: FakeAiGateway;
let run = 0;

const sync = (id: string, mode: 'backfill' | 'incremental' = 'backfill') =>
  runItemSync(inlineStep, { pluggyItemId: id, mode, trigger: 'manual', runId: `cat-${++run}` });

async function txBy(desc: string) {
  return db
    .select()
    .from(tx)
    .where(and(sql`${tx.srcDescription} like ${desc + '%'}`, isNull(tx.deletedAt)));
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  pluggy = new FakePluggy(todaySP());
  pluggy.seedInstitution('itau');
  pluggy.seedInstitution('nubank');
  setPluggyForTests(pluggy);
  ai = new FakeAiGateway();
  setAiForTests(ai);
});
afterEach(async () => {
  Object.assign(CATEGORIZE_CONFIG, { chunkSize: 40, batchMinMerchants: 50 });
  setPluggyForTests(undefined);
  setAiForTests(undefined);
  await close();
});

describe('categorização em camadas', () => {
  it('carga histórica vai em lote para a IA, uma vez por estabelecimento', async () => {
    Object.assign(CATEGORIZE_CONFIG, { chunkSize: 3, batchMinMerchants: 2 });
    await sync('fake-item-itau');
    await sync('fake-item-nubank');
    const [job] = await db.select().from(aiBatchJob);
    expect(job?.status).toBe('applied');

    const delivery = await categoryBySlug('delivery');
    const ifood = await txBy('IFD*IFOOD');
    expect(ifood.length).toBeGreaterThan(5);
    expect(ifood.every((t) => t.categoryId === delivery!.id && t.categorySource === 'ai')).toBe(
      true,
    );
    // um registro de cache por estabelecimento, não por transação
    const [m] = await db.select().from(merchant).where(eq(merchant.descriptionNorm, 'IFOOD'));
    expect(m).toMatchObject({ source: 'ai', nature: 'variable_recurring' });

    const salary = await txBy('SALARIO');
    expect(salary[0]!.categoryId).toBe((await categoryBySlug('salario'))!.id);
    // transferências, faturas e aplicações não recebem categoria
    expect((await txBy('PIX TRANSF ENVIADA')).every((t) => t.categoryId === null)).toBe(true);
    expect((await txBy('Pagamento de fatura')).every((t) => t.categoryId === null)).toBe(true);
  });

  it('estorno herda a categoria da compra original', async () => {
    await sync('fake-item-nubank');
    const [purchase] = await txBy('AMAZON MARKETPLACE');
    const [refund] = await txBy('Estorno AMAZON');
    expect(refund!.categoryId).toBe(purchase!.categoryId);
    expect(refund!.categorySource).toBe('link');
  });

  it('registra tokens e custo; lote custa metade', async () => {
    await sync('fake-item-itau');
    const usage = await db.select().from(aiUsageLog);
    expect(usage.length).toBeGreaterThan(0);
    expect(usage.every((u) => u.feature === 'categorize')).toBe(true);
  });

  it('baixa confiança vai para a fila de revisão', async () => {
    await sync('fake-item-itau');
    pluggy.addTx({
      accountId: 'fake-item-itau-checking',
      date: new Date(),
      description: 'PIX ENVIADO FULANO DE TAL',
      type: 'DEBIT',
      amount: -80,
    });
    await sync('fake-item-itau', 'incremental');
    const [t] = await txBy('PIX ENVIADO FULANO');
    expect(t).toMatchObject({ categorySource: 'ai' });
    const [r] = await db.select().from(reviewQueue).where(eq(reviewQueue.transactionId, t!.id));
    expect(r).toMatchObject({ status: 'pending', reason: 'low_confidence' });
  });

  it('correção vira regra, exemplo e vale para as parecidas — e a IA não é chamada de novo', async () => {
    await sync('fake-item-itau');
    const posto = await txBy('POSTO SHELL');
    const veiculo = await categoryBySlug('veiculo');
    const r = await correctCategory(posto[0]!.id, veiculo!.id, {
      createRule: true,
      applyToSimilar: true,
    });
    expect(r.similar).toBe(posto.length - 1);
    expect(r.ruleId).not.toBeNull();
    const [m] = await db.select().from(merchant).where(eq(merchant.descriptionNorm, 'POSTO SHELL'));
    expect(m).toMatchObject({ source: 'user', categoryId: veiculo!.id });
    const [first] = await db.select().from(tx).where(eq(tx.id, posto[0]!.id));
    expect(first!.categorySource).toBe('user');

    const callsBefore = ai.calls;
    pluggy.addTx({
      accountId: 'fake-item-itau-card',
      date: new Date(),
      description: 'POSTO SHELL',
      type: 'DEBIT',
      amount: 150,
    });
    await sync('fake-item-itau', 'incremental');
    const latest = await txBy('POSTO SHELL');
    expect(latest.every((t) => t.categoryId === veiculo!.id)).toBe(true);
    expect(ai.calls).toBe(callsBefore);
  });

  it('regra aplicada às antigas não mexe em decisão do usuário', async () => {
    await sync('fake-item-itau');
    const shell = await txBy('POSTO SHELL');
    const veiculo = await categoryBySlug('veiculo');
    const combustivel = await categoryBySlug('combustivel');
    await correctCategory(shell[0]!.id, veiculo!.id, { createRule: false, applyToSimilar: false });
    const [rule] = await db
      .insert(categorizationRule)
      .values({
        name: 'shell',
        conditions: { descriptionContains: ['shell'] },
        actions: { categoryId: combustivel!.id },
      })
      .returning();
    expect(await applyRuleRetroactively(rule!.id, true)).toBe(shell.length - 1);
    await applyRuleRetroactively(rule!.id, false);
    const [kept] = await db.select().from(tx).where(eq(tx.id, shell[0]!.id));
    expect(kept!.categoryId).toBe(veiculo!.id);
  });

  it('regra de tipo entra na classificação (ex.: Pix para a mãe é transferência)', async () => {
    await sync('fake-item-itau');
    await db.insert(categorizationRule).values({
      name: 'padaria',
      conditions: { descriptionContains: ['padaria sao'] },
      actions: { kind: 'internal_transfer' },
    });
    await postprocess();
    const rows = await txBy('PADARIA');
    expect(rows.every((t) => t.kind === 'internal_transfer' && t.kindSource === 'rule')).toBe(true);
  });

  it('teto mensal de gasto com IA', async () => {
    await db
      .insert(appUser)
      .values({ email: 'a@b.c', passwordHash: 'x', settings: { aiMonthlyBudgetUsd: 0 } });
    await sync('fake-item-itau');
    expect(ai.calls).toBe(0);
    expect(ai.batches.size).toBe(0);
    const r = await categorizePending({ mode: 'sync' });
    expect(r.aiSkipped).toMatch(/teto/);
  });

  it('sem chave da Anthropic: só regras e cache, sem erro', async () => {
    setAiForTests(null);
    await sync('fake-item-itau');
    const r = await categorizePending({ mode: 'sync' });
    expect(r.aiSkipped).toMatch(/sem chave/);
    expect(r.pendingAi).toBeGreaterThan(0);
  });
});
