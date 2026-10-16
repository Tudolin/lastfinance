import 'server-only';
import { and, gte, isNull, sql } from 'drizzle-orm';
import { assignToKnownBill, cashDateForDue, cycleForPurchase } from '@/domain/cards/billing-cycle';
import { classifyTransactions } from '@/domain/classification/classify';
import type { ClassifiableTx, TxKind } from '@/domain/classification/types';
import { bankingCalendar } from '@/domain/dates/business-days';
import { addDays, todaySP, type LocalDate } from '@/domain/dates/local-date';
import { getDb, schema } from '@/server/db/client';

const { account, transaction, creditCardBill, ownDocument } = schema;

/** Janela reclassificada a cada execução: o histórico inteiro que a Pluggy fornece (12 meses) + folga. */
export const POSTPROCESS_WINDOW_DAYS = 400;

type Update = {
  id: string;
  kind: TxKind;
  kindSource: 'user' | 'rule' | 'auto';
  kindConfidence: number;
  kindReason: string;
  linkedTransactionId: string | null;
  paidBillId: string | null;
  refundOfTransactionId: string | null;
  billId: string | null;
  cashDate: string;
};

/**
 * Recalcula, de forma determinística e idempotente, tudo que depende do conjunto de transações:
 * kind (transferência, fatura, investimento…), vínculos, fatura de cada compra e data de caixa.
 * Só grava linhas que mudaram.
 */
export async function postprocess(today: LocalDate = todaySP()) {
  const db = getDb();
  const from = addDays(today, -POSTPROCESS_WINDOW_DAYS);

  const [accounts, bills, docs, txs] = await Promise.all([
    db.select().from(account),
    db.select().from(creditCardBill),
    db.select().from(ownDocument),
    db
      .select()
      .from(transaction)
      .where(and(isNull(transaction.deletedAt), gte(transaction.date, from))),
  ]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const billByPluggyId = new Map(bills.filter((b) => b.pluggyBillId).map((b) => [b.pluggyBillId!, b]));
  const billsByAccount = new Map<string, typeof bills>();
  for (const b of bills) billsByAccount.set(b.accountId, [...(billsByAccount.get(b.accountId) ?? []), b]);

  const classified = classifyTransactions({
    accounts: accounts.map((a) => ({ id: a.id, kind: a.kind })),
    transactions: txs.map(
      (t): ClassifiableTx => ({
        id: t.id,
        accountId: t.accountId,
        date: t.date as LocalDate,
        amountCents: t.amountCents,
        description: t.srcDescription,
        counterpartyDocHash: t.counterpartyDocHash,
        userKind: t.userKind,
        ruleKind: null,
      }),
    ),
    bills: bills.map((b) => ({
      id: b.id,
      accountId: b.accountId,
      dueDate: b.dueDate as LocalDate,
      totalCents: b.totalCents,
      minimumCents: b.minimumPaymentCents,
      paymentsCents: b.payments.map((p) => p.amountCents),
    })),
    ownDocHashes: new Set(docs.map((d) => d.docHash)),
    calendar: bankingCalendar,
  });

  const updates: Update[] = [];
  for (const t of txs) {
    const c = classified.get(t.id)!;
    const acc = accountById.get(t.accountId);
    let billId: string | null = null;
    let cashDate = t.date;

    if (acc?.kind === 'credit_card' && c.kind !== 'card_payment') {
      // Compra/estorno no cartão: o dinheiro sai no vencimento da fatura.
      const bill =
        (t.pluggyBillId ? billByPluggyId.get(t.pluggyBillId) : undefined) ??
        assignToKnownBill(
          t.competenceDate as LocalDate,
          (billsByAccount.get(acc.id) ?? []).map((b) => ({ ...b, closingDate: b.closingDate as LocalDate | null, dueDate: b.dueDate as LocalDate })),
        );
      if (bill) {
        billId = bill.id;
        cashDate = cashDateForDue(bill.dueDate as LocalDate, bankingCalendar);
      } else if (acc.closingDay && acc.dueDay) {
        const cycle = cycleForPurchase(t.competenceDate as LocalDate, { closingDay: acc.closingDay, dueDay: acc.dueDay });
        cashDate = cashDateForDue(cycle.dueDate, bankingCalendar);
      }
    }

    const u: Update = {
      id: t.id,
      kind: c.kind,
      kindSource: c.source,
      kindConfidence: c.confidence,
      kindReason: c.reason,
      linkedTransactionId: c.linkedTransactionId,
      paidBillId: c.paidBillId,
      refundOfTransactionId: c.refundOfTransactionId,
      billId,
      cashDate,
    };
    const changed =
      t.kind !== u.kind ||
      t.kindSource !== u.kindSource ||
      Math.abs(t.kindConfidence - u.kindConfidence) > 0.001 ||
      t.kindReason !== u.kindReason ||
      t.linkedTransactionId !== u.linkedTransactionId ||
      t.paidBillId !== u.paidBillId ||
      t.refundOfTransactionId !== u.refundOfTransactionId ||
      t.billId !== u.billId ||
      t.cashDate !== u.cashDate;
    if (changed) updates.push(u);
  }

  for (let i = 0; i < updates.length; i += 500) {
    const chunk = updates.slice(i, i + 500);
    const values = sql.join(
      chunk.map(
        (u) =>
          sql`(${u.id}::uuid, ${u.kind}::tx_kind, ${u.kindSource}::kind_source, ${u.kindConfidence}::real, ${u.kindReason}, ${u.linkedTransactionId}::uuid, ${u.paidBillId}::uuid, ${u.refundOfTransactionId}::uuid, ${u.billId}::uuid, ${u.cashDate}::date)`,
      ),
      sql`, `,
    );
    await db.execute(sql`
      update ${transaction} as t set
        kind = v.kind, kind_source = v.kind_source, kind_confidence = v.kind_confidence, kind_reason = v.kind_reason,
        linked_transaction_id = v.linked, paid_bill_id = v.paid_bill, refund_of_transaction_id = v.refund_of,
        bill_id = v.bill, cash_date = v.cash_date, updated_at = now()
      from (values ${values}) as v(id, kind, kind_source, kind_confidence, kind_reason, linked, paid_bill, refund_of, bill, cash_date)
      where t.id = v.id`);
  }

  return { scanned: txs.length, updated: updates.length };
}
