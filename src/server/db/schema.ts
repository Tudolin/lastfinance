/**
 * Schema da Fase 1. Convenções:
 * - Dinheiro em centavos (`bigint`, modo number — seguro até ±9 quatrilhões de centavos).
 * - Datas de negócio como `date` (string 'YYYY-MM-DD'); instantes como `timestamptz`.
 * - `src_*` = dado vindo da Pluggy (o sync escreve); `user_*` = edição manual (o sync nunca toca).
 * - Exclusões vindas da Pluggy são lógicas (`deleted_at`), pois podem "voltar".
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const id = () => uuid('id').primaryKey().$defaultFn(() => uuidv7());
const cents = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ───────────────────────── Identidade e segurança ─────────────────────────

export const appUser = pgTable('app_user', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  totpSecretEnc: text('totp_secret_enc'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  /** Configurações (timeout de bloqueio, reserva mínima…) validadas por Zod em `settings.ts`. */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const webauthnCredential = pgTable('webauthn_credential', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: text('transports').array().notNull().default(sql`'{}'::text[]`),
  deviceName: text('device_name').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  lastUsedAt: ts('last_used_at'),
  ...timestamps,
});

export const session = pgTable(
  'session',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    ipPrefix: text('ip_prefix'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    /** Depois deste instante o app pede digital/senha de novo (bloqueio por inatividade). */
    unlockedUntil: ts('unlocked_until').notNull(),
    /** Última reautenticação (ações sensíveis exigem que seja recente). */
    stepUpAt: ts('step_up_at'),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const recoveryCode = pgTable('recovery_code', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
  codeHash: text('code_hash').notNull().unique(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const authAttempt = pgTable(
  'auth_attempt',
  {
    id: id(),
    /** 'login:<email>' ou 'ip:<prefixo>' */
    identifier: text('identifier').notNull(),
    success: boolean('success').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('auth_attempt_identifier_at_idx').on(t.identifier, t.at)],
);

export const challengePurpose = pgEnum('challenge_purpose', ['webauthn_register', 'webauthn_login', 'webauthn_stepup', 'totp_login']);

export const authChallenge = pgTable('auth_challenge', {
  id: id(),
  purpose: challengePurpose('purpose').notNull(),
  challenge: text('challenge').notNull(),
  userId: uuid('user_id').references(() => appUser.id, { onDelete: 'cascade' }),
  expiresAt: ts('expires_at').notNull(),
  usedAt: ts('used_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLog = pgTable('audit_log', {
  id: id(),
  userId: uuid('user_id').references(() => appUser.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  /** Nunca contém valores financeiros. */
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  at: ts('at').notNull().defaultNow(),
});

// ───────────────────────── Pluggy / Realizado ─────────────────────────

export const backfillState = pgEnum('backfill_state', ['pending', 'running', 'done', 'failed']);

export const institutionConnection = pgTable('institution_connection', {
  id: id(),
  pluggyItemId: text('pluggy_item_id').notNull().unique(),
  connectorId: integer('connector_id').notNull(),
  connectorName: text('connector_name').notNull(),
  connectorImageUrl: text('connector_image_url'),
  isOpenFinance: boolean('is_open_finance').notNull().default(false),
  status: text('status').notNull(),
  executionStatus: text('execution_status'),
  statusDetail: jsonb('status_detail').$type<unknown>(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  consentExpiresAt: ts('consent_expires_at'),
  pluggyLastUpdatedAt: ts('pluggy_last_updated_at'),
  nextAutoSyncAt: ts('next_auto_sync_at'),
  lastSyncedAt: ts('last_synced_at'),
  backfillState: backfillState('backfill_state').notNull().default('pending'),
  deletedAt: ts('deleted_at'),
  ...timestamps,
});

export const accountKind = pgEnum('account_kind', ['checking', 'savings', 'credit_card']);

export const account = pgTable('account', {
  id: id(),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => institutionConnection.id, { onDelete: 'cascade' }),
  pluggyAccountId: text('pluggy_account_id').notNull().unique(),
  kind: accountKind('kind').notNull(),
  name: text('name').notNull(),
  displayName: text('display_name'),
  /** Só os 4 últimos dígitos. */
  numberMasked: text('number_masked'),
  currency: text('currency').notNull().default('BRL'),
  balanceCents: cents('balance_cents').notNull().default(0),
  balanceAt: ts('balance_at'),
  creditLimitCents: cents('credit_limit_cents'),
  availableLimitCents: cents('available_limit_cents'),
  closingDay: integer('closing_day'),
  dueDay: integer('due_day'),
  closingDaySource: text('closing_day_source'),
  includeInCash: boolean('include_in_cash').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

/** Hashes (HMAC) dos documentos do titular, para reconhecer transferências para si mesmo. */
export const ownDocument = pgTable('own_document', {
  docHash: text('doc_hash').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const category = pgTable('category', {
  id: id(),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  pluggyCategoryId: text('pluggy_category_id').unique(),
  isSystem: boolean('is_system').notNull().default(false),
  archivedAt: ts('archived_at'),
  ...timestamps,
});

export const billStatus = pgEnum('bill_status', ['open', 'closed', 'paid', 'partial', 'overdue', 'projected']);

export const creditCardBill = pgTable(
  'credit_card_bill',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    pluggyBillId: text('pluggy_bill_id').unique(),
    closingDate: day('closing_date'),
    dueDate: day('due_date').notNull(),
    totalCents: cents('total_cents').notNull(),
    minimumPaymentCents: cents('minimum_payment_cents'),
    allowsInstallments: boolean('allows_installments'),
    financeCharges: jsonb('finance_charges').$type<unknown[]>().notNull().default([]),
    payments: jsonb('payments').$type<{ date: string; amountCents: number; valueType: string }[]>().notNull().default([]),
    status: billStatus('status').notNull().default('open'),
    paidCents: cents('paid_cents').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('bill_account_due_idx').on(t.accountId, t.dueDate)],
);

export const txKind = pgEnum('tx_kind', [
  'expense',
  'income',
  'internal_transfer',
  'investment_in',
  'investment_out',
  'card_payment',
  'refund',
  'adjustment',
]);
export const kindSource = pgEnum('kind_source', ['user', 'rule', 'auto']);
export const txStatus = pgEnum('tx_status', ['PENDING', 'POSTED']);
export const txSource = pgEnum('tx_source', ['pluggy', 'import', 'manual']);

export const transaction = pgTable(
  'transaction',
  {
    id: id(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'cascade' }),
    pluggyId: text('pluggy_id').unique(),
    providerId: text('provider_id'),
    providerCode: text('provider_code'),
    fingerprint: text('fingerprint').notNull(),
    source: txSource('source').notNull().default('pluggy'),

    srcDescription: text('src_description').notNull(),
    srcDescriptionRaw: text('src_description_raw'),
    descriptionNorm: text('description_norm').notNull(),
    userDescription: text('user_description'),
    /** + entrada / − saída (ver domain/transactions/normalize.ts). */
    amountCents: cents('amount_cents').notNull(),
    currency: text('currency').notNull().default('BRL'),
    type: text('type').notNull(),
    status: txStatus('status').notNull().default('POSTED'),
    operationType: text('operation_type'),

    date: day('date').notNull(),
    competenceDate: day('competence_date').notNull(),
    cashDate: day('cash_date').notNull(),
    billId: uuid('bill_id').references(() => creditCardBill.id, { onDelete: 'set null' }),
    pluggyBillId: text('pluggy_bill_id'),
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),

    kind: txKind('kind').notNull().default('expense'),
    kindSource: kindSource('kind_source').notNull().default('auto'),
    kindConfidence: real('kind_confidence').notNull().default(0),
    kindReason: text('kind_reason'),
    userKind: txKind('user_kind'),
    linkedTransactionId: uuid('linked_transaction_id'),
    paidBillId: uuid('paid_bill_id').references(() => creditCardBill.id, { onDelete: 'set null' }),
    refundOfTransactionId: uuid('refund_of_transaction_id'),

    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    notes: text('notes'),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    counterpartyDocHash: text('counterparty_doc_hash'),
    /** Payload da Pluggy sem documentos/contas da contraparte (ver sanitize). */
    srcPayload: jsonb('src_payload').$type<unknown>(),

    lastSeenRun: text('last_seen_run'),
    deletedAt: ts('deleted_at'),
    ...timestamps,
  },
  (t) => [
    index('tx_account_date_idx').on(t.accountId, t.date),
    index('tx_cash_date_idx').on(t.cashDate),
    index('tx_competence_date_idx').on(t.competenceDate),
    index('tx_fingerprint_idx').on(t.fingerprint),
    uniqueIndex('tx_provider_id_uq').on(t.accountId, t.providerId).where(sql`${t.providerId} is not null`),
  ],
);

export const investment = pgTable('investment', {
  id: id(),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => institutionConnection.id, { onDelete: 'cascade' }),
  pluggyInvestmentId: text('pluggy_investment_id').notNull().unique(),
  type: text('type').notNull(),
  subtype: text('subtype'),
  name: text('name').notNull(),
  issuer: text('issuer'),
  rate: real('rate'),
  rateType: text('rate_type'),
  fixedAnnualRate: real('fixed_annual_rate'),
  grossCents: cents('gross_cents'),
  netCents: cents('net_cents').notNull(),
  taxesCents: cents('taxes_cents'),
  profitCents: cents('profit_cents'),
  issueDate: day('issue_date'),
  dueDate: day('due_date'),
  status: text('status'),
  balanceAt: ts('balance_at'),
  deletedAt: ts('deleted_at'),
  ...timestamps,
});

export const investmentTransaction = pgTable('investment_transaction', {
  id: id(),
  investmentId: uuid('investment_id')
    .notNull()
    .references(() => investment.id, { onDelete: 'cascade' }),
  pluggyId: text('pluggy_id').notNull().unique(),
  type: text('type'),
  movementType: text('movement_type').notNull(),
  description: text('description'),
  date: day('date').notNull(),
  amountCents: cents('amount_cents').notNull(),
  netAmountCents: cents('net_amount_cents'),
  ...timestamps,
});

// ───────────────────────── Operação ─────────────────────────

export const webhookStatus = pgEnum('webhook_status', ['received', 'enqueued', 'processed', 'failed', 'ignored']);

export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: id(),
    eventId: text('event_id').notNull().unique(),
    event: text('event').notNull(),
    itemId: text('item_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: webhookStatus('status').notNull().default('received'),
    attempts: integer('attempts').notNull().default(0),
    error: text('error'),
    receivedAt: ts('received_at').notNull().defaultNow(),
    enqueuedAt: ts('enqueued_at'),
    processedAt: ts('processed_at'),
  },
  (t) => [index('webhook_status_idx').on(t.status, t.receivedAt)],
);

export const syncTrigger = pgEnum('sync_trigger', ['webhook', 'cron', 'manual', 'backfill', 'connect']);
export const syncStatus = pgEnum('sync_status', ['running', 'success', 'partial', 'error']);

export const syncLog = pgTable(
  'sync_log',
  {
    id: id(),
    connectionId: uuid('connection_id').references(() => institutionConnection.id, { onDelete: 'cascade' }),
    trigger: syncTrigger('trigger').notNull(),
    job: text('job').notNull(),
    status: syncStatus('status').notNull().default('running'),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    runId: text('run_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('sync_log_started_idx').on(t.startedAt)],
);
