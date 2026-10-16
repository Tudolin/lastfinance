import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/webhooks/pluggy/route';
import { todaySP } from '@/domain/dates/local-date';
import { setPluggyForTests } from '@/server/adapters/pluggy/client';
import { FakePluggy } from '@/server/adapters/pluggy/fake';
import { schema, type Db } from '@/server/db/client';
import { WEBHOOK_SECRET_HEADER } from '@/server/services/webhook-auth';
import { ingestWebhook } from '@/server/services/webhooks';
import { createTestDb } from './helpers/db';

const { transaction: tx, webhookEvent, institutionConnection } = schema;

let db: Db;
let close: () => Promise<void>;
let fake: FakePluggy;

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  fake = new FakePluggy(todaySP());
  fake.seedInstitution('nubank');
  setPluggyForTests(fake);
});
afterEach(async () => {
  setPluggyForTests(undefined);
  await close();
});

const post = (body: unknown, secret: string | null = process.env.PLUGGY_WEBHOOK_SECRET!) =>
  POST(
    new Request('http://localhost/api/webhooks/pluggy', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { [WEBHOOK_SECRET_HEADER]: secret } : {}),
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

describe('rota do webhook', () => {
  it('rejeita sem o header secreto (401, a Pluggy não reenvia)', async () => {
    expect((await post({ event: 'item/updated', eventId: 'e1', itemId: 'x' }, null)).status).toBe(
      401,
    );
    expect(
      (await post({ event: 'item/updated', eventId: 'e1', itemId: 'x' }, 'errado')).status,
    ).toBe(401);
  });

  it('rejeita JSON inválido ou sem eventId (400)', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({ event: 'item/updated' })).status).toBe(400);
  });

  it('item/created dispara a carga histórica completa', async () => {
    const res = await post({
      event: 'item/created',
      eventId: 'evt-1',
      itemId: 'fake-item-nubank',
      triggeredBy: 'USER',
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(tx);
    expect(rows.length).toBe(fake.txs.size);
    const [ev] = await db.select().from(webhookEvent).where(eq(webhookEvent.eventId, 'evt-1'));
    expect(ev!.status).toBe('processed');
  });

  it('é idempotente por eventId', async () => {
    await post({ event: 'item/created', eventId: 'evt-dup', itemId: 'fake-item-nubank' });
    const r2 = await post({
      event: 'item/created',
      eventId: 'evt-dup',
      itemId: 'fake-item-nubank',
    });
    expect(await r2.json()).toMatchObject({ status: 'duplicate' });
    expect(await db.select().from(webhookEvent)).toHaveLength(1);
  });
});

describe('eventos de transações', () => {
  beforeEach(async () => {
    await ingestWebhook({ event: 'item/created', eventId: 'boot', itemId: 'fake-item-nubank' });
  });

  it('transactions/created busca só as novas', async () => {
    const from = new Date().toISOString();
    const t = fake.addTx({
      accountId: 'fake-item-nubank-card',
      date: new Date(),
      description: 'IFD*IFOOD',
      type: 'DEBIT',
      amount: 58.9,
    });
    await ingestWebhook({
      event: 'transactions/created',
      eventId: 'c1',
      itemId: 'fake-item-nubank',
      accountId: 'fake-item-nubank-card',
      transactionsCreatedAtFrom: from,
      createdTransactionsLink: 'https://api.pluggy.ai/transactions?...',
    });
    const [row] = await db.select().from(tx).where(eq(tx.pluggyId, t.id));
    expect(row).toMatchObject({ amountCents: -5890, kind: 'expense' });
  });

  it('transactions/updated atualiza (PENDING → POSTED)', async () => {
    const t = fake.addTx({
      accountId: 'fake-item-nubank-checking',
      date: new Date(),
      description: 'Compra débito',
      type: 'DEBIT',
      amount: -10,
      status: 'PENDING',
    });
    await ingestWebhook({
      event: 'transactions/created',
      eventId: 'c2',
      itemId: 'fake-item-nubank',
      accountId: 'fake-item-nubank-checking',
      transactionsCreatedAtFrom: new Date(Date.now() - 60_000).toISOString(),
    });
    fake.txs.set(t.id, { ...fake.txs.get(t.id)!, status: 'POSTED' });
    await ingestWebhook({
      event: 'transactions/updated',
      eventId: 'u1',
      itemId: 'fake-item-nubank',
      clientId: 'c',
      accountId: 'fake-item-nubank-checking',
      transactionIds: [t.id],
    });
    const [row] = await db.select().from(tx).where(eq(tx.pluggyId, t.id));
    expect(row!.status).toBe('POSTED');
  });

  it('transactions/deleted faz exclusão lógica', async () => {
    const [any] = await db.select().from(tx).limit(1);
    await ingestWebhook({
      event: 'transactions/deleted',
      eventId: 'd1',
      itemId: 'fake-item-nubank',
      clientId: 'c',
      accountId: 'x',
      transactionIds: [any!.pluggyId],
    });
    const [row] = await db.select().from(tx).where(eq(tx.id, any!.id));
    expect(row!.deletedAt).not.toBeNull();
  });

  it('item/error atualiza o status da conexão (precisa reconectar)', async () => {
    fake.setItemStatus('fake-item-nubank', 'LOGIN_ERROR', {
      code: 'INVALID_CREDENTIALS',
      message: 'consentimento expirado',
    });
    await ingestWebhook({
      event: 'item/error',
      eventId: 'err1',
      itemId: 'fake-item-nubank',
      error: { code: 'INVALID_CREDENTIALS', message: 'x' },
    });
    const [c] = await db.select().from(institutionConnection);
    expect(c).toMatchObject({ status: 'LOGIN_ERROR', errorCode: 'INVALID_CREDENTIALS' });
  });

  it('eventos de pagamento são ignorados (app somente leitura)', async () => {
    await ingestWebhook({
      event: 'payment_intent/created',
      eventId: 'p1',
      paymentIntentId: 'x',
      paymentRequestId: 'y',
    });
    const [ev] = await db.select().from(webhookEvent).where(eq(webhookEvent.eventId, 'p1'));
    expect(ev!.status).toBe('ignored');
  });
});
