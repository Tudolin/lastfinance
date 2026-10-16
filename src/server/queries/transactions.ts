import 'server-only';
import {
  and,
  between,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import { KIND_EFFECT, TX_KINDS, type TxKind } from '@/domain/classification/types';
import { requireUnlocked } from '@/server/auth/request';
import { getDb, schema } from '@/server/db/client';

const { transaction: tx, account, institutionConnection } = schema;

export const transactionFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  account: z.string().uuid().optional(),
  kind: z.enum(TX_KINDS).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  min: z.coerce.number().nonnegative().optional(),
  max: z.coerce.number().nonnegative().optional(),
  basis: z.enum(['cash', 'accrual']).default('cash'),
  category: z.union([z.string().uuid(), z.literal('none')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
});
export type TransactionFilters = z.infer<typeof transactionFiltersSchema>;

export const PAGE_SIZE = 100;

export async function listTransactions(f: TransactionFilters) {
  await requireUnlocked();
  const dateCol = f.basis === 'cash' ? tx.cashDate : tx.competenceDate;
  const where: SQL[] = [isNull(tx.deletedAt)];
  if (f.account) where.push(eq(tx.accountId, f.account));
  if (f.kind) where.push(eq(tx.kind, f.kind));
  if (f.category === 'none')
    where.push(and(isNull(tx.categoryId), inArray(tx.kind, ['expense', 'income', 'refund']))!);
  else if (f.category)
    where.push(
      sql`(${tx.categoryId} = ${f.category} or exists (select 1 from transaction_split s where s.transaction_id = "transaction"."id" and s.category_id = ${f.category}) or ${tx.categoryId} in (select id from category where parent_id = ${f.category}))`,
    );
  if (f.from) where.push(gte(dateCol, f.from));
  if (f.to) where.push(lte(dateCol, f.to));
  if (f.min != null) where.push(sql`abs(${tx.amountCents}) >= ${Math.round(f.min * 100)}`);
  if (f.max != null) where.push(sql`abs(${tx.amountCents}) <= ${Math.round(f.max * 100)}`);
  if (f.q) {
    const term = `%${f.q.replace(/[%_]/g, '')}%`;
    const asNumber = Number(f.q.replace(/\./g, '').replace(',', '.'));
    where.push(
      or(
        ilike(tx.srcDescription, term),
        ilike(tx.userDescription, term),
        ilike(tx.notes, term),
        f.q.startsWith('#') ? sql`${f.q.slice(1)} = any(${tx.tags})` : sql`false`,
        Number.isFinite(asNumber) && asNumber > 0
          ? eq(sql`abs(${tx.amountCents})`, Math.round(asNumber * 100))
          : sql`false`,
      )!,
    );
  }
  const rows = await getDb()
    .select({
      id: tx.id,
      date: dateCol,
      purchaseDate: tx.competenceDate,
      description: sql<string>`coalesce(${tx.userDescription}, ${tx.srcDescription})`,
      amountCents: tx.amountCents,
      kind: tx.kind,
      kindSource: tx.kindSource,
      kindConfidence: tx.kindConfidence,
      status: tx.status,
      installmentNumber: tx.installmentNumber,
      installmentTotal: tx.installmentTotal,
      notes: tx.notes,
      categoryId: tx.categoryId,
      categorySource: tx.categorySource,
      accountId: tx.accountId,
      accountName: account.name,
      accountKind: account.kind,
      institution: institutionConnection.connectorName,
    })
    .from(tx)
    .innerJoin(account, eq(tx.accountId, account.id))
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(and(...where))
    .orderBy(desc(dateCol), desc(tx.date), desc(tx.id))
    .limit(PAGE_SIZE + 1)
    .offset((f.page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

export async function getTransaction(id: string) {
  await requireUnlocked();
  const [row] = await getDb()
    .select({
      t: tx,
      accountName: account.name,
      accountKind: account.kind,
      institution: institutionConnection.connectorName,
    })
    .from(tx)
    .innerJoin(account, eq(tx.accountId, account.id))
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .where(eq(tx.id, id));
  if (!row) return null;
  const linkedIds = [row.t.linkedTransactionId, row.t.refundOfTransactionId].filter(
    (v): v is string => !!v,
  );
  const linked = linkedIds.length
    ? await getDb()
        .select({
          id: tx.id,
          description: tx.srcDescription,
          date: tx.date,
          amountCents: tx.amountCents,
          accountName: account.name,
        })
        .from(tx)
        .innerJoin(account, eq(tx.accountId, account.id))
        .where(inArray(tx.id, linkedIds))
    : [];
  return { ...row, linked };
}

export async function listAccountsForFilter() {
  await requireUnlocked();
  return getDb()
    .select({
      id: account.id,
      name: account.name,
      institution: institutionConnection.connectorName,
    })
    .from(account)
    .innerJoin(institutionConnection, eq(account.connectionId, institutionConnection.id))
    .orderBy(institutionConnection.connectorName, account.name);
}

export type MonthSummary = { incomeCents: number; expenseCents: number; investedCents: number };

/** Receita, gasto e aplicações num período, respeitando caixa × competência e os kinds. */
export async function summarize(
  from: string,
  to: string,
  basis: 'cash' | 'accrual',
): Promise<MonthSummary> {
  await requireUnlocked();
  const dateCol = basis === 'cash' ? tx.cashDate : tx.competenceDate;
  const rows = await getDb()
    .select({ kind: tx.kind, total: sql<number>`sum(${tx.amountCents})::bigint` })
    .from(tx)
    .where(and(isNull(tx.deletedAt), between(dateCol, from, to)))
    .groupBy(tx.kind);
  let income = 0;
  let expense = 0;
  let invested = 0;
  for (const r of rows) {
    const k = r.kind as TxKind;
    const v = Number(r.total);
    if (KIND_EFFECT[k].income) income += v;
    if (KIND_EFFECT[k].expense) expense += v; // estornos (positivos) abatem as despesas (negativas)
    if (k === 'investment_in' || k === 'investment_out') invested += -v;
  }
  return { incomeCents: income, expenseCents: -expense, investedCents: invested };
}
