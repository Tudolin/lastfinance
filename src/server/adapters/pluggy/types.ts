import { z } from 'zod';

/**
 * Contrato interno com a Pluggy. Tudo que entra do SDK passa por estes schemas (Zod),
 * para que mudanças na API quebrem aqui — com erro claro — e não no meio do sync.
 * Datas chegam como Date (o SDK converte) ou string ISO.
 */
const dateLike = z
  .union([z.date(), z.string()])
  .transform((v) => (v instanceof Date ? v : new Date(v)));
const nullableDate = dateLike
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const num = z.number();
const nullableNum = z
  .number()
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const nullableStr = z
  .string()
  .nullable()
  .optional()
  .transform((v) => v ?? null);

export const pluggyItemSchema = z.object({
  id: z.string(),
  connector: z.object({
    id: z.number(),
    name: z.string(),
    imageUrl: nullableStr,
    isOpenFinance: z
      .boolean()
      .nullable()
      .optional()
      .transform((v) => v ?? false),
  }),
  status: z.string(),
  executionStatus: nullableStr,
  statusDetail: z
    .unknown()
    .optional()
    .transform((v) => v ?? null),
  error: z
    .object({ code: z.string(), message: z.string().nullable().optional() })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  consentExpiresAt: nullableDate,
  lastUpdatedAt: nullableDate,
  nextAutoSyncAt: nullableDate,
});
export type PluggyItem = z.output<typeof pluggyItemSchema>;

export const pluggyAccountSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  type: z.enum(['BANK', 'CREDIT']),
  subtype: z.enum(['CHECKING_ACCOUNT', 'SAVINGS_ACCOUNT', 'CREDIT_CARD']),
  number: nullableStr,
  balance: num,
  name: z.string(),
  marketingName: nullableStr,
  taxNumber: nullableStr,
  currencyCode: z.string().default('BRL'),
  bankData: z
    .object({ transferNumber: nullableStr })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  creditData: z
    .object({
      balanceCloseDate: nullableDate,
      balanceDueDate: nullableDate,
      availableCreditLimit: nullableNum,
      creditLimit: nullableNum,
      minimumPayment: nullableNum,
    })
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});
export type PluggyAccount = z.output<typeof pluggyAccountSchema>;

/** Campo opcional que a Pluggy às vezes manda como `null` (Open Finance): vira `undefined`. */
const opt = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null ? undefined : v), schema.optional());

const participant = opt(
  z
    .object({
      documentNumber: opt(
        z.object({ value: opt(z.string()), type: opt(z.string()) }).passthrough(),
      ),
      name: opt(z.string()),
    })
    .passthrough(),
);

export const pluggyTransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: dateLike,
  description: z.string(),
  descriptionRaw: nullableStr,
  type: z.enum(['DEBIT', 'CREDIT']),
  amount: num,
  currencyCode: z.string().default('BRL'),
  status: z.enum(['PENDING', 'POSTED']).optional().default('POSTED'),
  providerCode: nullableStr,
  providerId: nullableStr,
  operationType: nullableStr,
  paymentData: z
    .object({ payer: participant, receiver: participant, paymentMethod: opt(z.string()) })
    .passthrough()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  creditCardMetadata: z
    .object({
      installmentNumber: opt(z.number()),
      totalInstallments: opt(z.number()),
      totalAmount: opt(z.number()),
      purchaseDate: opt(dateLike),
      billId: opt(z.string()),
    })
    .passthrough()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});
export type PluggyTransaction = z.output<typeof pluggyTransactionSchema>;

export const pluggyBillSchema = z.object({
  id: z.string(),
  dueDate: dateLike,
  billClosingDate: nullableDate,
  totalAmount: num,
  minimumPaymentAmount: nullableNum,
  allowsInstallments: z
    .boolean()
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  financeCharges: z.array(z.object({ type: z.string(), amount: num }).passthrough()).default([]),
  payments: z
    .array(z.object({ paymentDate: dateLike, amount: num, valueType: z.string() }).passthrough())
    .default([]),
});
export type PluggyBill = z.output<typeof pluggyBillSchema>;

export const pluggyInvestmentSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  type: z.string(),
  subtype: nullableStr,
  name: z.string(),
  issuer: nullableStr,
  rate: nullableNum,
  rateType: nullableStr,
  fixedAnnualRate: nullableNum,
  amount: nullableNum,
  balance: num,
  taxes: nullableNum,
  amountProfit: nullableNum,
  issueDate: nullableDate,
  dueDate: nullableDate,
  status: nullableStr,
});
export type PluggyInvestment = z.output<typeof pluggyInvestmentSchema>;

export const pluggyInvestmentTxSchema = z.object({
  id: z.string(),
  type: nullableStr,
  movementType: z.enum(['DEBIT', 'CREDIT']),
  description: nullableStr,
  date: dateLike,
  amount: nullableNum,
  netAmount: nullableNum,
  value: nullableNum,
});
export type PluggyInvestmentTx = z.output<typeof pluggyInvestmentTxSchema>;

export type TransactionQuery = {
  dateFrom?: string;
  createdAtFrom?: string;
  ids?: string[];
  after?: string | null;
};
export type TransactionPage = { results: PluggyTransaction[]; next: string | null };

/** Porta para a Pluggy. Implementações: SDK real (`client.ts`) e fake determinístico (`fake.ts`). */
export interface PluggyGateway {
  fetchItem(itemId: string): Promise<PluggyItem>;
  fetchAccounts(itemId: string): Promise<PluggyAccount[]>;
  fetchTransactionsPage(accountId: string, q: TransactionQuery): Promise<TransactionPage>;
  fetchBills(accountId: string): Promise<PluggyBill[]>;
  fetchInvestments(itemId: string): Promise<PluggyInvestment[]>;
  fetchInvestmentTransactions(investmentId: string): Promise<PluggyInvestmentTx[]>;
  createConnectToken(opts: { itemId?: string; webhookUrl?: string }): Promise<string>;
  /** Pede à Pluggy uma nova coleta (gasta cota do Open Finance). */
  requestItemUpdate(itemId: string): Promise<void>;
  /** Webhooks globais da conta Pluggy (avisam quando um item termina de atualizar). */
  listWebhooks(): Promise<PluggyWebhook[]>;
  createWebhook(url: string, headers: Record<string, string>): Promise<PluggyWebhook>;
  deleteWebhook(id: string): Promise<void>;
}

export type PluggyWebhook = { id: string; url: string; event: string };

/** Extrai o cursor `after` de um `next` como "?after=abc&dateFrom=…". */
export function parseAfterCursor(next: string | null | undefined): string | null {
  if (!next) return null;
  const qs = next.includes('?') ? next.slice(next.indexOf('?') + 1) : next;
  return new URLSearchParams(qs).get('after');
}
