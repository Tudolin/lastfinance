import 'server-only';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';

const { account, institutionConnection, creditCardBill, investment, syncLog } = schema;

export async function getConnections() {
  await requireUnlocked();
  const db = getDb();
  const conns = await db
    .select()
    .from(institutionConnection)
    .where(isNull(institutionConnection.deletedAt))
    .orderBy(institutionConnection.connectorName);
  const accts = conns.length
    ? await db
        .select()
        .from(account)
        .where(
          inArray(
            account.connectionId,
            conns.map((c) => c.id),
          ),
        )
    : [];
  return conns.map((c) => ({ ...c, accounts: accts.filter((a) => a.connectionId === c.id) }));
}

export async function getBalances() {
  await requireUnlocked();
  const db = getDb();
  const rows = await db
    .select({ a: account, connectorName: institutionConnection.connectorName })
    .from(account)
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(and(eq(account.isActive, true), isNull(institutionConnection.deletedAt)));
  const bank = rows.filter((r) => r.a.kind !== 'credit_card');
  const cards = rows.filter((r) => r.a.kind === 'credit_card');
  const [inv] = await db
    .select({ total: sql<number>`coalesce(sum(${investment.netCents}), 0)::bigint` })
    .from(investment)
    .where(isNull(investment.deletedAt));
  return {
    cashCents: bank.filter((r) => r.a.includeInCash).reduce((s, r) => s + r.a.balanceCents, 0),
    bank: bank.map((r) => ({
      id: r.a.id,
      name: r.a.name,
      institution: r.connectorName,
      balanceCents: r.a.balanceCents,
    })),
    cards: cards.map((r) => ({
      id: r.a.id,
      name: r.a.name,
      institution: r.connectorName,
      creditLimitCents: r.a.creditLimitCents,
      availableLimitCents: r.a.availableLimitCents,
      closingDay: r.a.closingDay,
      dueDay: r.a.dueDay,
    })),
    investmentsCents: Number(inv?.total ?? 0),
  };
}

/** Fatura aberta mais próxima de cada cartão. */
export async function getOpenBills(today: string) {
  await requireUnlocked();
  const db = getDb();
  const bills = await db
    .select({
      b: creditCardBill,
      accountName: account.name,
      institution: institutionConnection.connectorName,
    })
    .from(creditCardBill)
    .innerJoin(account, eq(creditCardBill.accountId, account.id))
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(and(gte(creditCardBill.dueDate, today), eq(account.isActive, true)))
    .orderBy(creditCardBill.dueDate);
  const first = new Map<string, (typeof bills)[number]>();
  for (const b of bills) if (!first.has(b.b.accountId)) first.set(b.b.accountId, b);
  return [...first.values()].map((r) => ({
    accountId: r.b.accountId,
    accountName: r.accountName,
    institution: r.institution,
    dueDate: r.b.dueDate,
    closingDate: r.b.closingDate,
    totalCents: r.b.totalCents,
    status: r.b.status,
  }));
}

export async function getSyncStatus() {
  await requireUnlocked();
  const db = getDb();
  const [last] = await db
    .select()
    .from(syncLog)
    .where(eq(syncLog.status, 'success'))
    .orderBy(desc(syncLog.finishedAt))
    .limit(1);
  const conns = await db
    .select({
      name: institutionConnection.connectorName,
      next: institutionConnection.nextAutoSyncAt,
      status: institutionConnection.status,
    })
    .from(institutionConnection)
    .where(isNull(institutionConnection.deletedAt));
  return { lastSuccessAt: last?.finishedAt ?? null, connections: conns };
}

export async function getSyncLogs(limit = 50) {
  await requireUnlocked();
  return getDb()
    .select({ log: syncLog, connectorName: institutionConnection.connectorName })
    .from(syncLog)
    .leftJoin(institutionConnection, eq(syncLog.connectionId, institutionConnection.id))
    .orderBy(desc(syncLog.startedAt))
    .limit(limit);
}
