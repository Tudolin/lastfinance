import 'server-only';
import { resolveInstallment } from '@/domain/classification/installments';
import type { AccountKind } from '@/domain/classification/types';
import { toLocalDateSP, type LocalDate } from '@/domain/dates/local-date';
import { toCents } from '@/domain/money';
import { normalizeDescription } from '@/domain/text/normalize';
import { signedAmountCents, transactionFingerprint } from '@/domain/transactions/normalize';
import type { PluggyAccount, PluggyTransaction } from '@/server/adapters/pluggy/types';
import { hashDocument } from '@/server/security/crypto';

/**
 * A Pluggy manda datas de transação como instante. Meia-noite UTC (inclusive com alguns
 * milissegundos, como o Nubank manda: `00:00:00.001Z`) é uma data "pura", sem hora, e usamos o
 * dia UTC; com hora de verdade, convertemos para o fuso de São Paulo.
 */
export function pluggyDateToLocal(d: Date): LocalDate {
  const iso = d.toISOString();
  if (/T00:00:00\.\d{3}Z$/.test(iso)) return iso.slice(0, 10) as LocalDate;
  return toLocalDateSP(d);
}

export function accountKindOf(a: Pick<PluggyAccount, 'subtype'>): AccountKind {
  switch (a.subtype) {
    case 'CREDIT_CARD':
      return 'credit_card';
    case 'SAVINGS_ACCOUNT':
      return 'savings';
    default:
      return 'checking';
  }
}

export function maskNumber(n: string | null): string | null {
  const digits = (n ?? '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

export function mapAccount(a: PluggyAccount) {
  const kind = accountKindOf(a);
  const cd = a.creditData;
  return {
    pluggyAccountId: a.id,
    kind,
    name: a.marketingName ?? a.name,
    numberMasked: maskNumber(a.number),
    currency: a.currencyCode,
    balanceCents: toCents(a.balance),
    balanceAt: new Date(),
    creditLimitCents: cd?.creditLimit != null ? toCents(cd.creditLimit) : null,
    availableLimitCents: cd?.availableCreditLimit != null ? toCents(cd.availableCreditLimit) : null,
    closingDay: cd?.balanceCloseDate
      ? Number(pluggyDateToLocal(cd.balanceCloseDate).slice(8, 10))
      : null,
    dueDay: cd?.balanceDueDate ? Number(pluggyDateToLocal(cd.balanceDueDate).slice(8, 10)) : null,
    isActive: true,
  };
}

/** Remove documento e dados bancários da contraparte antes de guardar o payload bruto. */
export function sanitizeTransactionPayload(t: PluggyTransaction): Record<string, unknown> {
  const pd = t.paymentData;
  return {
    id: t.id,
    operationType: t.operationType,
    paymentMethod: pd?.paymentMethod ?? null,
    payerName: pd?.payer?.name ?? null,
    receiverName: pd?.receiver?.name ?? null,
    creditCardMetadata: t.creditCardMetadata
      ? {
          installmentNumber: t.creditCardMetadata.installmentNumber ?? null,
          totalInstallments: t.creditCardMetadata.totalInstallments ?? null,
          billId: t.creditCardMetadata.billId ?? null,
        }
      : null,
  };
}

export type MappedTransaction = ReturnType<typeof mapTransaction>;

export function mapTransaction(t: PluggyTransaction, acc: { id: string; kind: AccountKind }) {
  const date = pluggyDateToLocal(t.date);
  const amountCents = signedAmountCents(acc.kind, t.type, t.amount);
  const inst = resolveInstallment(t.creditCardMetadata, t.description);
  const counterpartyDoc =
    amountCents < 0
      ? t.paymentData?.receiver?.documentNumber?.value
      : t.paymentData?.payer?.documentNumber?.value;
  return {
    accountId: acc.id,
    pluggyId: t.id,
    providerId: t.providerId,
    providerCode: t.providerCode,
    fingerprint: transactionFingerprint(acc.id, date, amountCents, t.description),
    source: 'pluggy' as const,
    srcDescription: t.description,
    srcDescriptionRaw: t.descriptionRaw,
    descriptionNorm: normalizeDescription(t.description),
    amountCents,
    currency: t.currencyCode,
    type: t.type,
    status: t.status,
    operationType: t.operationType,
    date,
    // Competência é a data da transação. Em parcelas, `purchaseDate` é a data da compra original
    // (vem só nelas); usá-la jogaria todas as parcelas no mês da compra.
    competenceDate: date,
    cashDate: date,
    pluggyBillId: t.creditCardMetadata?.billId ?? null,
    installmentNumber: inst?.number ?? null,
    installmentTotal: inst?.total ?? null,
    counterpartyDocHash: hashDocument(counterpartyDoc),
    srcPayload: sanitizeTransactionPayload(t),
  };
}
