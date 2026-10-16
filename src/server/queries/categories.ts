import 'server-only';
import { and, between, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';
import {
  listCategories as listAll,
  categoryLabel,
  type CategoryRow,
} from '@/server/services/categories';

const {
  transaction: tx,
  transactionSplit: split,
  categorizationRule,
  reviewQueue,
  account,
  institutionConnection,
  categorySuggestion,
  aiUsageLog,
} = schema;

export async function getCategories(includeArchived = false) {
  await requireUnlocked();
  const all = await listAll(true);
  const list = includeArchived ? all : all.filter((c) => !c.archivedAt);
  return list.map((c) => ({ ...c, label: categoryLabel(c, all) }));
}

export type CategoryWithLabel = CategoryRow & { label: string };

/**
 * Gasto por categoria no período (despesas e estornos), respeitando caixa × competência.
 * Transações divididas contam pelas partes. Valor positivo = gasto líquido.
 */
export async function categoryBreakdown(from: string, to: string, basis: 'cash' | 'accrual') {
  await requireUnlocked();
  const dateCol = basis === 'cash' ? tx.cashDate : tx.competenceDate;
  const rows = await getDb()
    .select({
      categoryId: sql<string | null>`coalesce(${split.categoryId}, ${tx.categoryId})`,
      cents: sql<number>`-sum(coalesce(${split.amountCents}, ${tx.amountCents}))::bigint`,
      count: sql<number>`count(distinct ${tx.id})::int`,
    })
    .from(tx)
    .leftJoin(split, eq(split.transactionId, tx.id))
    .where(
      and(
        isNull(tx.deletedAt),
        inArray(tx.kind, ['expense', 'refund']),
        between(dateCol, from, to),
      ),
    )
    .groupBy(sql`1`);
  return rows.map((r) => ({ categoryId: r.categoryId, cents: Number(r.cents), count: r.count }));
}

export async function getRules() {
  await requireUnlocked();
  return getDb()
    .select()
    .from(categorizationRule)
    .orderBy(categorizationRule.priority, categorizationRule.name);
}

export async function getReviewItems(limit = 100) {
  await requireUnlocked();
  return getDb()
    .select({
      reviewId: reviewQueue.id,
      reason: reviewQueue.reason,
      suggested: reviewQueue.suggested,
      id: tx.id,
      description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
      descriptionNorm: tx.descriptionNorm,
      amountCents: tx.amountCents,
      date: tx.date,
      categoryId: tx.categoryId,
      accountName: account.name,
      institution: institutionConnection.connectorName,
    })
    .from(reviewQueue)
    .innerJoin(tx, eq(reviewQueue.transactionId, tx.id))
    .innerJoin(account, eq(tx.accountId, account.id))
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(and(eq(reviewQueue.status, 'pending'), isNull(tx.deletedAt)))
    .orderBy(desc(tx.date))
    .limit(limit);
}

export async function countPendingReview() {
  await requireUnlocked();
  const [r] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(reviewQueue)
    .innerJoin(tx, eq(reviewQueue.transactionId, tx.id))
    .where(and(eq(reviewQueue.status, 'pending'), isNull(tx.deletedAt)));
  return r?.n ?? 0;
}

/** Despesas/receitas ainda sem categoria (ex.: IA desligada ou no teto de gasto). */
export async function getUncategorized(limit = 50) {
  await requireUnlocked();
  return getDb()
    .select({
      id: tx.id,
      description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
      amountCents: tx.amountCents,
      date: tx.date,
      accountName: account.name,
      institution: institutionConnection.connectorName,
    })
    .from(tx)
    .innerJoin(account, eq(tx.accountId, account.id))
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(
      and(
        isNull(tx.deletedAt),
        isNull(tx.categoryId),
        inArray(tx.kind, ['expense', 'income', 'refund']),
      ),
    )
    .orderBy(desc(tx.date))
    .limit(limit);
}

export async function getCategorySuggestions() {
  await requireUnlocked();
  return getDb().select().from(categorySuggestion).where(eq(categorySuggestion.status, 'pending'));
}

export async function getSplits(transactionId: string) {
  await requireUnlocked();
  return getDb().select().from(split).where(eq(split.transactionId, transactionId));
}

export async function aiUsageSummary(sinceMonthStart: Date) {
  await requireUnlocked();
  const [r] = await getDb()
    .select({
      calls: sql<number>`count(*)::int`,
      micros: sql<number>`coalesce(sum(${aiUsageLog.costMicrosUsd}), 0)::bigint`,
      input: sql<number>`coalesce(sum(${aiUsageLog.inputTokens}), 0)::bigint`,
      output: sql<number>`coalesce(sum(${aiUsageLog.outputTokens}), 0)::bigint`,
    })
    .from(aiUsageLog)
    .where(sql`${aiUsageLog.at} >= ${sinceMonthStart}`);
  return {
    calls: r?.calls ?? 0,
    costUsd: Number(r?.micros ?? 0) / 1e6,
    inputTokens: Number(r?.input ?? 0),
    outputTokens: Number(r?.output ?? 0),
  };
}
