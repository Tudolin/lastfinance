import 'server-only';
import { and, eq, gte, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { inferCycleConfig } from '@/domain/cards/billing-cycle';
import {
  institutionFromAccounts,
  isMeuPluggy,
  mapAccount,
  mapTransaction,
  pluggyDateToLocal,
  type MappedTransaction,
} from './pluggy-mapping';
import { toCents } from '@/domain/money';
import { todaySP, type LocalDate } from '@/domain/dates/local-date';
import { getPluggy } from '@/server/adapters/pluggy/client';
import type { PluggyItem, TransactionQuery } from '@/server/adapters/pluggy/types';
import { getDb, schema } from '@/server/db/client';
import { hashDocument } from '@/server/security/crypto';

const {
  institutionConnection,
  account,
  transaction,
  creditCardBill,
  investment,
  investmentTransaction,
  ownDocument,
  syncLog,
} = schema;

export type SyncTrigger = (typeof schema.syncTrigger.enumValues)[number];

// ───────────────────────── Conexão (item) ─────────────────────────

function connectionValues(item: PluggyItem) {
  return {
    pluggyItemId: item.id,
    connectorId: item.connector.id,
    connectorName: item.connector.name,
    connectorImageUrl: item.connector.imageUrl,
    isOpenFinance: item.connector.isOpenFinance,
    status: item.status,
    executionStatus: item.executionStatus,
    statusDetail: item.statusDetail,
    errorCode: item.error?.code ?? null,
    errorMessage: item.error?.message ?? null,
    consentExpiresAt: item.consentExpiresAt,
    pluggyLastUpdatedAt: item.lastUpdatedAt,
    nextAutoSyncAt: item.nextAutoSyncAt,
    deletedAt: null,
  };
}

/** Busca o item na Pluggy e grava/atualiza a conexão. */
export async function refreshConnection(pluggyItemId: string) {
  const item = await (await getPluggy()).fetchItem(pluggyItemId);
  const values = connectionValues(item);
  // No MeuPluggy o nome real do banco vem das contas (syncAccounts); não volta a ser "MeuPluggy".
  const { connectorName: _name, ...keepName } = values;
  const [row] = await getDb()
    .insert(institutionConnection)
    .values(values)
    .onConflictDoUpdate({
      target: institutionConnection.pluggyItemId,
      set: isMeuPluggy(item.connector) ? keepName : values,
    })
    .returning();
  return row!;
}

export async function markConnectionDeleted(pluggyItemId: string) {
  await getDb()
    .update(institutionConnection)
    .set({ deletedAt: new Date(), status: 'DELETED' })
    .where(eq(institutionConnection.pluggyItemId, pluggyItemId));
}

// ───────────────────────── Contas ─────────────────────────

export type SyncedAccount = {
  id: string;
  pluggyAccountId: string;
  kind: 'checking' | 'savings' | 'credit_card';
};

export async function syncAccounts(connectionId: string): Promise<SyncedAccount[]> {
  const db = getDb();
  const [conn] = await db
    .select()
    .from(institutionConnection)
    .where(eq(institutionConnection.id, connectionId));
  if (!conn) throw new Error('Conexão não encontrada');
  const remote = await (await getPluggy()).fetchAccounts(conn.pluggyItemId);
  const out: SyncedAccount[] = [];

  if (isMeuPluggy({ id: conn.connectorId, name: conn.connectorName })) {
    const bank = institutionFromAccounts(remote);
    if (bank && bank !== conn.connectorName)
      await db
        .update(institutionConnection)
        .set({ connectorName: bank })
        .where(eq(institutionConnection.id, conn.id));
  }

  for (const a of remote) {
    const v = mapAccount(a);
    const [existing] = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.pluggyAccountId, a.id));
    let id = existing?.id;
    if (!id) {
      // Item reconectado como novo: reaproveita a conta antiga da mesma instituição (mesmo tipo e final),
      // preservando histórico e edições manuais.
      const [orphan] = await db
        .select({ id: account.id })
        .from(account)
        .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
        .where(
          and(
            eq(institutionConnection.connectorId, conn.connectorId),
            ne(institutionConnection.id, conn.id),
            eq(account.kind, v.kind),
            v.numberMasked ? eq(account.numberMasked, v.numberMasked) : sql`false`,
          ),
        )
        .limit(1);
      id = orphan?.id;
    }
    const keepCycle = {
      ...(v.closingDay != null ? { closingDay: v.closingDay, closingDaySource: 'pluggy' } : {}),
      ...(v.dueDay != null ? { dueDay: v.dueDay } : {}),
    };
    const { closingDay: _c, dueDay: _d, ...base } = v;
    if (id) {
      await db
        .update(account)
        .set({ ...base, ...keepCycle, connectionId })
        .where(eq(account.id, id));
    } else {
      const [row] = await db
        .insert(account)
        .values({ ...base, ...keepCycle, connectionId })
        .returning({ id: account.id });
      id = row!.id;
    }
    out.push({ id, pluggyAccountId: a.id, kind: v.kind });

    const doc = hashDocument(a.taxNumber);
    if (doc) await db.insert(ownDocument).values({ docHash: doc }).onConflictDoNothing();
  }

  const seen = out.map((o) => o.id);
  await db
    .update(account)
    .set({ isActive: false })
    .where(
      and(
        eq(account.connectionId, connectionId),
        seen.length ? notInArray(account.id, seen) : sql`true`,
      ),
    );
  return out;
}

// ───────────────────────── Transações ─────────────────────────

/** Colunas que vêm da Pluggy e podem ser sobrescritas a cada sync. Nunca inclui `user_*` nem classificação. */
function srcUpdateSet(runId: string) {
  return {
    providerId: sql`excluded.provider_id`,
    providerCode: sql`excluded.provider_code`,
    fingerprint: sql`excluded.fingerprint`,
    srcDescription: sql`excluded.src_description`,
    srcDescriptionRaw: sql`excluded.src_description_raw`,
    descriptionNorm: sql`excluded.description_norm`,
    amountCents: sql`excluded.amount_cents`,
    currency: sql`excluded.currency`,
    type: sql`excluded.type`,
    status: sql`excluded.status`,
    operationType: sql`excluded.operation_type`,
    date: sql`excluded.date`,
    competenceDate: sql`excluded.competence_date`,
    pluggyBillId: sql`excluded.pluggy_bill_id`,
    installmentNumber: sql`excluded.installment_number`,
    installmentTotal: sql`excluded.installment_total`,
    counterpartyDocHash: sql`excluded.counterparty_doc_hash`,
    srcPayload: sql`excluded.src_payload`,
    deletedAt: sql`null`,
    lastSeenRun: sql`${runId}`,
    updatedAt: sql`now()`,
  };
}

export type UpsertCounts = { inserted: number; updated: number; reattached: number };

/**
 * Upsert idempotente por `pluggy_id`. Quando a Pluggy troca o id de uma transação, reaproveita a linha
 * antiga (e as edições manuais) casando por `provider_id` ou pela impressão digital de uma linha já apagada.
 */
export async function upsertTransactions(
  acc: SyncedAccount,
  rows: MappedTransaction[],
  runId: string,
): Promise<UpsertCounts> {
  if (rows.length === 0) return { inserted: 0, updated: 0, reattached: 0 };
  return getDb().transaction(async (db) => {
    const ids = rows.map((r) => r.pluggyId);
    const existing = await db
      .select({ pluggyId: transaction.pluggyId })
      .from(transaction)
      .where(inArray(transaction.pluggyId, ids));
    const known = new Set(existing.map((e) => e.pluggyId));
    let reattached = 0;
    const claimed = new Set<string>();

    for (const r of rows) {
      if (known.has(r.pluggyId)) continue;
      const [match] = await db
        .select({ id: transaction.id })
        .from(transaction)
        .where(
          and(
            eq(transaction.accountId, acc.id),
            r.providerId
              ? eq(transaction.providerId, r.providerId)
              : and(eq(transaction.fingerprint, r.fingerprint), isNotNull(transaction.deletedAt)),
            claimed.size ? notInArray(transaction.id, [...claimed]) : sql`true`,
          ),
        )
        .limit(1);
      if (match) {
        claimed.add(match.id);
        await db
          .update(transaction)
          .set({ pluggyId: r.pluggyId })
          .where(eq(transaction.id, match.id));
        reattached++;
        known.add(r.pluggyId);
      }
    }

    await db
      .insert(transaction)
      .values(rows.map((r) => ({ ...r, lastSeenRun: runId })))
      .onConflictDoUpdate({ target: transaction.pluggyId, set: srcUpdateSet(runId) });

    const updated = existing.length;
    return { inserted: rows.length - updated - reattached, updated, reattached };
  });
}

export async function syncTransactionsPage(acc: SyncedAccount, q: TransactionQuery, runId: string) {
  const page = await (await getPluggy()).fetchTransactionsPage(acc.pluggyAccountId, q);
  const counts = await upsertTransactions(
    acc,
    page.results.map((t) => mapTransaction(t, acc)),
    runId,
  );
  return { next: page.next, count: page.results.length, ...counts };
}

/** Exclusão lógica + migração das edições manuais para a "sucessora" (mesma impressão digital). */
async function softDelete(where: ReturnType<typeof and>) {
  const db = getDb();
  const deleted = await db
    .update(transaction)
    .set({ deletedAt: new Date() })
    .where(and(where, isNull(transaction.deletedAt)))
    .returning();
  for (const d of deleted) {
    const hasEdits = d.userDescription || d.userKind || d.notes || d.tags.length > 0;
    if (!hasEdits) continue;
    const [heir] = await db
      .select({ id: transaction.id })
      .from(transaction)
      .where(
        and(
          eq(transaction.accountId, d.accountId),
          eq(transaction.fingerprint, d.fingerprint),
          isNull(transaction.deletedAt),
          isNull(transaction.userKind),
          isNull(transaction.userDescription),
          isNull(transaction.notes),
          ne(transaction.id, d.id),
        ),
      )
      .limit(1);
    if (heir) {
      await db
        .update(transaction)
        .set({
          userDescription: d.userDescription,
          userKind: d.userKind,
          notes: d.notes,
          tags: d.tags,
          categoryId: d.categoryId,
        })
        .where(eq(transaction.id, heir.id));
    }
  }
  return deleted.length;
}

export function softDeleteByPluggyIds(pluggyIds: string[]) {
  if (pluggyIds.length === 0) return Promise.resolve(0);
  return softDelete(and(inArray(transaction.pluggyId, pluggyIds)));
}

/** Depois de varrer uma janela inteira: o que não apareceu nesta execução foi apagado na origem. */
export function markMissingAsDeleted(accountId: string, from: LocalDate, runId: string) {
  return softDelete(
    and(
      eq(transaction.accountId, accountId),
      eq(transaction.source, 'pluggy'),
      gte(transaction.date, from),
      or(isNull(transaction.lastSeenRun), ne(transaction.lastSeenRun, runId)),
    ),
  );
}

// ───────────────────────── Faturas ─────────────────────────

export async function syncBills(acc: SyncedAccount, today: LocalDate = todaySP()) {
  if (acc.kind !== 'credit_card') return 0;
  const db = getDb();
  const bills = await (await getPluggy()).fetchBills(acc.pluggyAccountId);
  for (const b of bills) {
    const dueDate = pluggyDateToLocal(b.dueDate);
    const closingDate = b.billClosingDate ? pluggyDateToLocal(b.billClosingDate) : null;
    const totalCents = toCents(b.totalAmount);
    const paidCents = b.payments.reduce((s, p) => s + toCents(p.amount), 0);
    const status =
      paidCents >= totalCents && totalCents > 0
        ? 'paid'
        : paidCents > 0
          ? 'partial'
          : dueDate < today
            ? 'overdue'
            : closingDate && closingDate <= today
              ? 'closed'
              : 'open';
    const values = {
      accountId: acc.id,
      pluggyBillId: b.id,
      closingDate,
      dueDate,
      totalCents,
      minimumPaymentCents: b.minimumPaymentAmount != null ? toCents(b.minimumPaymentAmount) : null,
      allowsInstallments: b.allowsInstallments,
      financeCharges: b.financeCharges,
      payments: b.payments.map((p) => ({
        date: pluggyDateToLocal(p.paymentDate),
        amountCents: toCents(p.amount),
        valueType: p.valueType,
      })),
      status: status as (typeof schema.billStatus.enumValues)[number],
      paidCents,
    };
    await db
      .insert(creditCardBill)
      .values(values)
      .onConflictDoUpdate({ target: creditCardBill.pluggyBillId, set: values });
  }

  // Sem fechamento/vencimento informados na conta, deduz pelas faturas.
  const [acct] = await db.select().from(account).where(eq(account.id, acc.id));
  if (acct && (acct.closingDay == null || acct.dueDay == null)) {
    const rows = await db
      .select({ closingDate: creditCardBill.closingDate, dueDate: creditCardBill.dueDate })
      .from(creditCardBill)
      .where(eq(creditCardBill.accountId, acc.id));
    const cfg = inferCycleConfig(
      rows.map((r) => ({
        closingDate: r.closingDate as LocalDate | null,
        dueDate: r.dueDate as LocalDate,
      })),
    );
    if (cfg) {
      await db
        .update(account)
        .set({
          closingDay: acct.closingDay ?? cfg.closingDay,
          dueDay: acct.dueDay ?? cfg.dueDay,
          closingDaySource: acct.closingDaySource ?? 'inferred',
        })
        .where(eq(account.id, acc.id));
    }
  }
  return bills.length;
}

// ───────────────────────── Investimentos ─────────────────────────

export async function syncInvestments(connectionId: string) {
  const db = getDb();
  const [conn] = await db
    .select()
    .from(institutionConnection)
    .where(eq(institutionConnection.id, connectionId));
  if (!conn) return 0;
  const pluggy = await getPluggy();
  const list = await pluggy.fetchInvestments(conn.pluggyItemId);
  const seen: string[] = [];
  for (const i of list) {
    const values = {
      connectionId,
      pluggyInvestmentId: i.id,
      type: i.type,
      subtype: i.subtype,
      name: i.name,
      issuer: i.issuer,
      rate: i.rate,
      rateType: i.rateType,
      fixedAnnualRate: i.fixedAnnualRate,
      grossCents: i.amount != null ? toCents(i.amount) : null,
      netCents: toCents(i.balance),
      taxesCents: i.taxes != null ? toCents(i.taxes) : null,
      profitCents: i.amountProfit != null ? toCents(i.amountProfit) : null,
      issueDate: i.issueDate ? pluggyDateToLocal(i.issueDate) : null,
      dueDate: i.dueDate ? pluggyDateToLocal(i.dueDate) : null,
      status: i.status,
      balanceAt: new Date(),
      deletedAt: null,
    };
    const [row] = await db
      .insert(investment)
      .values(values)
      .onConflictDoUpdate({ target: investment.pluggyInvestmentId, set: values })
      .returning({ id: investment.id });
    seen.push(i.id);
    const txs = await pluggy.fetchInvestmentTransactions(i.id);
    for (const t of txs) {
      const amount = t.amount ?? t.value ?? 0;
      const v = {
        investmentId: row!.id,
        pluggyId: t.id,
        type: t.type,
        movementType: t.movementType,
        description: t.description,
        date: pluggyDateToLocal(t.date),
        amountCents: toCents(amount),
        netAmountCents: t.netAmount != null ? toCents(t.netAmount) : null,
      };
      await db
        .insert(investmentTransaction)
        .values(v)
        .onConflictDoUpdate({ target: investmentTransaction.pluggyId, set: v });
    }
  }
  await db
    .update(investment)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(investment.connectionId, connectionId),
        isNull(investment.deletedAt),
        seen.length ? notInArray(investment.pluggyInvestmentId, seen) : sql`true`,
      ),
    );
  return list.length;
}

// ───────────────────────── Log de sincronização ─────────────────────────

export async function startSyncLog(p: {
  connectionId: string | null;
  trigger: SyncTrigger;
  job: string;
  runId: string;
}) {
  const [row] = await getDb().insert(syncLog).values(p).returning({ id: syncLog.id });
  return row!.id;
}

export async function finishSyncLog(
  id: string,
  p: {
    status: 'success' | 'partial' | 'error';
    counts?: Record<string, number>;
    errorCode?: string | null;
    errorMessage?: string | null;
  },
) {
  await getDb()
    .update(syncLog)
    .set({ ...p, finishedAt: new Date() })
    .where(eq(syncLog.id, id));
}

export async function markConnectionSynced(connectionId: string, backfillDone: boolean) {
  await getDb()
    .update(institutionConnection)
    .set({ lastSyncedAt: new Date(), ...(backfillDone ? { backfillState: 'done' as const } : {}) })
    .where(eq(institutionConnection.id, connectionId));
}
