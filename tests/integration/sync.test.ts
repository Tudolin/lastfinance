import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { todaySP } from '@/domain/dates/local-date';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import type { Db } from '@/server/db/client';
import { schema } from '@/server/db/client';
import { inlineStep } from '@/server/jobs/step';
import { runItemSync } from '@/server/services/item-sync';
import { postprocess } from '@/server/services/postprocess';
import { createTestDb } from './helpers/db';

const {
  transaction: tx,
  account,
  creditCardBill,
  investment,
  syncLog,
  institutionConnection,
} = schema;

let db: Db;
let close: () => Promise<void>;
let fake: FakePluggy;
let run = 0;

const sync = (pluggyItemId: string, mode: 'backfill' | 'incremental' = 'backfill') =>
  runItemSync(inlineStep, { pluggyItemId, mode, trigger: 'manual', runId: `test-${++run}` });

async function liveTx() {
  return db.select().from(tx).where(isNull(tx.deletedAt));
}

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  fake = new FakePluggy(todaySP());
  fake.seedInstitution('itau');
  fake.seedInstitution('nubank');
  setPluggyForTests(fake);
});

afterEach(async () => {
  setPluggyForTests(undefined);
  await close();
});

describe('carga histórica', () => {
  it('importa tudo, sem duplicatas, em várias páginas', async () => {
    fake.pageSize = 37; // força paginação
    await sync('fake-item-itau');
    await sync('fake-item-nubank');
    const rows = await liveTx();
    expect(rows.length).toBe(fake.txs.size);
    expect(new Set(rows.map((r) => r.pluggyId)).size).toBe(rows.length);

    const [conn] = await db
      .select()
      .from(institutionConnection)
      .where(eq(institutionConnection.pluggyItemId, 'fake-item-itau'));
    expect(conn!.backfillState).toBe('done');
    const logs = await db.select().from(syncLog);
    expect(logs.every((l) => l.status === 'success')).toBe(true);
    expect(logs[0]!.counts.pages).toBeGreaterThan(1);
  });

  it('é idempotente: rodar de novo não muda nada', async () => {
    await sync('fake-item-itau');
    await sync('fake-item-nubank');
    const before = await db
      .select({ id: tx.id, kind: tx.kind, cash: tx.cashDate })
      .from(tx)
      .orderBy(tx.id);
    await sync('fake-item-itau', 'incremental');
    await sync('fake-item-nubank', 'incremental');
    const after = await db
      .select({ id: tx.id, kind: tx.kind, cash: tx.cashDate })
      .from(tx)
      .orderBy(tx.id);
    expect(after).toEqual(before);
  });

  it('classifica transferências, faturas, aplicações e estornos', async () => {
    await sync('fake-item-itau');
    await sync('fake-item-nubank');
    const rows = await liveTx();
    const by = (pred: (r: (typeof rows)[number]) => boolean) => rows.filter(pred);

    const pixOut = by((r) => r.srcDescription.startsWith('PIX TRANSF ENVIADA'));
    expect(pixOut.length).toBeGreaterThan(0);
    for (const o of pixOut) {
      expect(o.kind).toBe('internal_transfer');
      const peer = rows.find((r) => r.id === o.linkedTransactionId);
      expect(peer?.srcDescription).toBe('Transferência recebida pelo Pix');
    }

    for (const p of by(
      (r) =>
        r.srcDescription === 'Pagamento de fatura' || r.srcDescription.startsWith('ITAU CARTOES'),
    )) {
      expect(p.kind).toBe('card_payment');
      expect(p.paidBillId).not.toBeNull();
    }
    for (const p of by((r) => r.srcDescription === 'Pagamento recebido'))
      expect(p.kind).toBe('card_payment');
    for (const p of by((r) => r.srcDescription === 'Aplicação RDB'))
      expect(p.kind).toBe('investment_in');
    for (const p of by((r) => r.srcDescription === 'Resgate RDB'))
      expect(p.kind).toBe('investment_out');
    expect(
      by((r) => r.srcDescription.startsWith('SALARIO')).every((r) => r.kind === 'income'),
    ).toBe(true);

    const refund = by((r) => r.srcDescription.startsWith('Estorno'))[0]!;
    expect(refund.kind).toBe('refund');
    expect(rows.find((r) => r.id === refund.refundOfTransactionId)?.srcDescription).toBe(
      'AMAZON MARKETPLACE',
    );
  });

  it('nunca conta pagamento de fatura como despesa', async () => {
    await sync('fake-item-itau');
    await sync('fake-item-nubank');
    const [r] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tx)
      .where(and(eq(tx.kind, 'expense'), sql`${tx.srcDescription} ilike '%fatura%'`));
    expect(r!.n).toBe(0);
  });

  it('parcelas, fatura de cada compra e caixa × competência no cartão', async () => {
    await sync('fake-item-itau');
    const rows = await liveTx();
    const parcel = rows.find((r) => r.srcDescription.startsWith('NOTEBOOK DELL 02/10'));
    expect(parcel).toMatchObject({ installmentNumber: 2, installmentTotal: 10 });

    const bills = await db.select().from(creditCardBill);
    expect(bills.length).toBeGreaterThan(5);
    const purchase = rows.find((r) => r.srcDescription === 'POSTO SHELL' && r.billId)!;
    const bill = bills.find((b) => b.id === purchase.billId)!;
    expect(purchase.competenceDate).toBe(purchase.date);
    expect(purchase.cashDate >= bill.dueDate).toBe(true); // vencimento (ou próximo dia útil)

    const [card] = await db.select().from(account).where(eq(account.kind, 'credit_card'));
    expect(card!.closingDay).toBe(28);
    expect(card!.dueDay).toBe(5);
  });

  it('importa a caixinha como investimento', async () => {
    await sync('fake-item-nubank');
    const inv = await db.select().from(investment);
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ subtype: 'CDB', rateType: 'CDI', netCents: 2176000 });
  });
});

describe('mudanças na origem', () => {
  it('exclusão some do app e volta se a transação reaparecer', async () => {
    await sync('fake-item-itau');
    const victim = [...fake.txs.values()].find(
      (t) => t.description === 'DEB AUT VIVO FIBRA' && t.date >= new Date(Date.now() - 20 * 864e5),
    )!;
    const saved = { ...victim };
    fake.deleteTx(victim.id);
    await sync('fake-item-itau', 'incremental');
    const [gone] = await db.select().from(tx).where(eq(tx.pluggyId, victim.id));
    expect(gone!.deletedAt).not.toBeNull();

    fake.txs.set(saved.id, saved);
    await sync('fake-item-itau', 'incremental');
    const [back] = await db.select().from(tx).where(eq(tx.pluggyId, victim.id));
    expect(back!.deletedAt).toBeNull();
  });

  it('troca de id pela Pluggy preserva edições manuais', async () => {
    await sync('fake-item-itau');
    const recent = [...fake.txs.values()].find(
      (t) => t.description.startsWith('PADARIA') && t.date >= new Date(Date.now() - 30 * 864e5),
    )!;
    const [row] = await db.select().from(tx).where(eq(tx.pluggyId, recent.id));
    await db
      .update(tx)
      .set({ notes: 'café com o time', userKind: 'adjustment' })
      .where(eq(tx.id, row!.id));

    const newId = fake.changeTxId(recent.id);
    await sync('fake-item-itau', 'incremental');

    const [heir] = await db.select().from(tx).where(eq(tx.pluggyId, newId));
    expect(heir).toMatchObject({
      notes: 'café com o time',
      userKind: 'adjustment',
      kind: 'adjustment',
      kindSource: 'user',
    });
    const [old] = await db.select().from(tx).where(eq(tx.id, row!.id));
    expect(old!.deletedAt).not.toBeNull();
  });

  it('troca de id com providerId reaproveita a mesma linha', async () => {
    const t = fake.addTx({
      accountId: 'fake-item-itau-checking',
      date: new Date(),
      description: 'MERCADINHO',
      type: 'DEBIT',
      amount: -12.5,
      providerId: 'prov-1',
    });
    await sync('fake-item-itau');
    const [row] = await db.select().from(tx).where(eq(tx.pluggyId, t.id));
    await db.update(tx).set({ notes: 'nota' }).where(eq(tx.id, row!.id));
    const nid = fake.changeTxId(t.id);
    await sync('fake-item-itau', 'incremental');
    const [same] = await db.select().from(tx).where(eq(tx.id, row!.id));
    expect(same).toMatchObject({ pluggyId: nid, notes: 'nota', deletedAt: null });
  });

  it('decisão do usuário sobrevive ao pós-processamento', async () => {
    await sync('fake-item-itau');
    const [salary] = await db
      .select()
      .from(tx)
      .where(sql`${tx.srcDescription} like 'SALARIO%'`)
      .limit(1);
    await db.update(tx).set({ userKind: 'adjustment' }).where(eq(tx.id, salary!.id));
    await postprocess();
    const [after] = await db.select().from(tx).where(eq(tx.id, salary!.id));
    expect(after).toMatchObject({ kind: 'adjustment', kindSource: 'user' });
  });

  it('conta inativa quando some da Pluggy', async () => {
    await sync('fake-item-itau');
    fake.accounts.delete('fake-item-itau-card');
    await sync('fake-item-itau', 'incremental');
    const inactive = await db.select().from(account).where(eq(account.isActive, false));
    expect(inactive).toHaveLength(1);
    const deleted = await db.select().from(tx).where(isNotNull(tx.deletedAt));
    expect(deleted).toHaveLength(0); // dados da conta antiga continuam
  });
});
