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
const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());
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
  userId: uuid('user_id')
    .notNull()
    .references(() => appUser.id, { onDelete: 'cascade' }),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: bytea('public_key').notNull(),
  counter: bigint('counter', { mode: 'number' }).notNull().default(0),
  transports: text('transports')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  deviceName: text('device_name').notNull(),
  backedUp: boolean('backed_up').notNull().default(false),
  lastUsedAt: ts('last_used_at'),
  ...timestamps,
});

export const session = pgTable(
  'session',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUser.id, { onDelete: 'cascade' }),
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
  userId: uuid('user_id')
    .notNull()
    .references(() => appUser.id, { onDelete: 'cascade' }),
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

export const challengePurpose = pgEnum('challenge_purpose', [
  'webauthn_register',
  'webauthn_login',
  'webauthn_stepup',
  'totp_login',
]);

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

export const categoryKind = pgEnum('category_kind', ['expense', 'income']);

export const category = pgTable('category', {
  id: id(),
  /** Identificador estável das categorias padrão (usado pela IA como enum). Nulo nas criadas pelo usuário. */
  slug: text('slug').unique(),
  parentId: uuid('parent_id'),
  kind: categoryKind('kind').notNull().default('expense'),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  sortOrder: integer('sort_order').notNull().default(0),
  pluggyCategoryId: text('pluggy_category_id').unique(),
  isSystem: boolean('is_system').notNull().default(false),
  archivedAt: ts('archived_at'),
  ...timestamps,
});

export const billStatus = pgEnum('bill_status', [
  'open',
  'closed',
  'paid',
  'partial',
  'overdue',
  'projected',
]);

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
    payments: jsonb('payments')
      .$type<{ date: string; amountCents: number; valueType: string }[]>()
      .notNull()
      .default([]),
    status: billStatus('status').notNull().default('open'),
    paidCents: cents('paid_cents').notNull().default(0),
    ...timestamps,
  },
  (t) => [index('bill_account_due_idx').on(t.accountId, t.dueDate)],
);

export const categorySource = pgEnum('category_source', ['user', 'rule', 'merchant', 'ai', 'link']);

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
    categorySource: categorySource('category_source'),
    categoryConfidence: real('category_confidence'),
    ruleId: uuid('rule_id'),
    notes: text('notes'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
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
    uniqueIndex('tx_provider_id_uq')
      .on(t.accountId, t.providerId)
      .where(sql`${t.providerId} is not null`),
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

export const webhookStatus = pgEnum('webhook_status', [
  'received',
  'enqueued',
  'processed',
  'failed',
  'ignored',
]);

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

export const syncTrigger = pgEnum('sync_trigger', [
  'webhook',
  'cron',
  'manual',
  'backfill',
  'connect',
]);
export const syncStatus = pgEnum('sync_status', ['running', 'success', 'partial', 'error']);

export const syncLog = pgTable(
  'sync_log',
  {
    id: id(),
    connectionId: uuid('connection_id').references(() => institutionConnection.id, {
      onDelete: 'cascade',
    }),
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

// ───────────────────────── Fase 2: categorização, orçamentos, IA ─────────────────────────

export const transactionSplit = pgTable(
  'transaction_split',
  {
    id: id(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transaction.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    /** Mesmo sinal da transação; a soma das partes é igual ao valor da transação. */
    amountCents: cents('amount_cents').notNull(),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('split_tx_idx').on(t.transactionId)],
);

export const ruleOrigin = pgEnum('rule_origin', ['user', 'correction']);

export const categorizationRule = pgTable('categorization_rule', {
  id: id(),
  name: text('name').notNull(),
  priority: integer('priority').notNull().default(100),
  enabled: boolean('enabled').notNull().default(true),
  conditions: jsonb('conditions').$type<Record<string, unknown>>().notNull(),
  actions: jsonb('actions').$type<Record<string, unknown>>().notNull(),
  origin: ruleOrigin('origin').notNull().default('user'),
  hits: integer('hits').notNull().default(0),
  lastHitAt: ts('last_hit_at'),
  ...timestamps,
});

export const merchantSource = pgEnum('merchant_source', ['ai', 'user']);

/** Cache de categorização por estabelecimento (descrição normalizada): o mesmo comerciante não vai duas vezes à IA. */
export const merchant = pgTable('merchant', {
  id: id(),
  descriptionNorm: text('description_norm').notNull().unique(),
  displayName: text('display_name'),
  categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
  nature: text('nature'),
  looksRecurring: boolean('looks_recurring'),
  periodicity: text('periodicity'),
  confidence: real('confidence'),
  source: merchantSource('source').notNull(),
  model: text('model'),
  ...timestamps,
});

export const reviewStatus = pgEnum('review_status', ['pending', 'resolved', 'dismissed']);

export const reviewQueue = pgTable(
  'review_queue',
  {
    id: id(),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transaction.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    suggested: jsonb('suggested').$type<Record<string, unknown>>().notNull().default({}),
    status: reviewStatus('status').notNull().default('pending'),
    createdAt: ts('created_at').notNull().defaultNow(),
    resolvedAt: ts('resolved_at'),
  },
  (t) => [
    uniqueIndex('review_pending_uq')
      .on(t.transactionId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const categorySuggestion = pgTable('category_suggestion', {
  id: id(),
  name: text('name').notNull().unique(),
  parentName: text('parent_name'),
  examples: text('examples')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  status: reviewStatus('status').notNull().default('pending'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const budget = pgTable(
  'budget',
  {
    id: id(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => category.id, { onDelete: 'cascade' }),
    /** primeiro dia do mês */
    month: day('month').notNull(),
    amountCents: cents('amount_cents').notNull(),
    rollover: boolean('rollover').notNull().default(false),
    rolledInCents: cents('rolled_in_cents').notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('budget_cat_month_uq').on(t.categoryId, t.month)],
);

export const aiUsageLog = pgTable(
  'ai_usage_log',
  {
    id: id(),
    feature: text('feature').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    batch: boolean('batch').notNull().default(false),
    /** custo em milionésimos de dólar */
    costMicrosUsd: bigint('cost_micros_usd', { mode: 'number' }).notNull().default(0),
    latencyMs: integer('latency_ms'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('ai_usage_at_idx').on(t.at)],
);

export const aiBatchStatus = pgEnum('ai_batch_status', ['submitted', 'ended', 'applied', 'failed']);

export const aiBatchJob = pgTable('ai_batch_job', {
  id: id(),
  anthropicBatchId: text('anthropic_batch_id').notNull().unique(),
  feature: text('feature').notNull(),
  status: aiBatchStatus('status').notNull().default('submitted'),
  itemCount: integer('item_count').notNull(),
  /** id do item no lote → descrição normalizada do estabelecimento (sem dados pessoais) */
  mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
  submittedAt: ts('submitted_at').notNull().defaultNow(),
  endedAt: ts('ended_at'),
  error: text('error'),
});

// ───────────────────────── Planejado (Fase 3) ─────────────────────────

export const direction = pgEnum('direction', ['in', 'out']);

/** Tabelas fiscais versionadas por vigência (INSS, IRRF, Lei 15.270, Simples…). */
export const taxTable = pgTable(
  'tax_table',
  {
    id: id(),
    kind: text('kind').notNull(),
    validFrom: day('valid_from').notNull(),
    validTo: day('valid_to'),
    payload: jsonb('payload').notNull(),
    sourceUrl: text('source_url').notNull(),
    verifiedAt: day('verified_at').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('tax_table_kind_from_uq').on(t.kind, t.validFrom)],
);

export const incomeType = pgEnum('income_type', ['clt', 'pj', 'other']);
export const incomeStatus = pgEnum('income_status', ['active', 'paused', 'ended']);
export const forecastMode = pgEnum('forecast_mode', ['calculated', 'calibrated']);

export const incomeSource = pgTable('income_source', {
  id: id(),
  name: text('name').notNull(),
  type: incomeType('type').notNull(),
  employerName: text('employer_name'),
  /** Palavras que aparecem na transação do pagamento (para a conciliação). */
  matchPattern: text('match_pattern'),
  accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
  categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
  startDate: day('start_date').notNull(),
  endDate: day('end_date'),
  status: incomeStatus('status').notNull().default('active'),
  paymentRule: jsonb('payment_rule').notNull(),
  deductions: jsonb('deductions').notNull().default({}),
  pjConfig: jsonb('pj_config'),
  forecastMode: forecastMode('forecast_mode').notNull().default('calculated'),
  calibrationFactor: real('calibration_factor').notNull().default(1),
  prorateFirstMonth: boolean('prorate_first_month').notNull().default(true),
  ...timestamps,
});

/** Histórico do salário/faturamento com vigência (sem sobreposição: validado na aplicação). */
export const incomeSalaryHistory = pgTable(
  'income_salary_history',
  {
    id: id(),
    incomeSourceId: uuid('income_source_id')
      .notNull()
      .references(() => incomeSource.id, { onDelete: 'cascade' }),
    grossCents: cents('gross_cents').notNull(),
    validFrom: day('valid_from').notNull(),
    validTo: day('valid_to'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('income_salary_from_uq').on(t.incomeSourceId, t.validFrom)],
);

export const incomeEventType = pgEnum('income_event_type', [
  '13_1',
  '13_2',
  'vacation',
  'plr',
  'bonus',
  'other',
]);

export const incomeEvent = pgTable('income_event', {
  id: id(),
  incomeSourceId: uuid('income_source_id')
    .notNull()
    .references(() => incomeSource.id, { onDelete: 'cascade' }),
  type: incomeEventType('type').notNull(),
  expectedDate: day('expected_date').notNull(),
  /** Nulo = calculado pelo salário vigente. */
  grossCents: cents('gross_cents'),
  /** Valor líquido informado (PLR, outros); quando presente, vale ele. */
  netCents: cents('net_cents'),
  vacationDays: integer('vacation_days'),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const periodicity = pgEnum('periodicity', ['weekly', 'monthly', 'yearly']);
export const recurringStatus = pgEnum('recurring_status', ['suggested', 'confirmed', 'ignored']);
export const recurringNature = pgEnum('recurring_nature', ['fixed', 'variable']);

export const recurringItem = pgTable(
  'recurring_item',
  {
    id: id(),
    name: text('name').notNull(),
    direction: direction('direction').notNull(),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
    /** Chave de detecção (descrição normalizada); nula para itens criados à mão. */
    descriptionNorm: text('description_norm'),
    matchPattern: text('match_pattern'),
    amountCents: cents('amount_cents').notNull(),
    tolerancePct: real('tolerance_pct').notNull().default(0.05),
    nature: recurringNature('nature').notNull().default('fixed'),
    periodicity: periodicity('periodicity').notNull().default('monthly'),
    anchorDay: integer('anchor_day').notNull(),
    anchorMonth: integer('anchor_month'),
    startDate: day('start_date').notNull(),
    endDate: day('end_date'),
    status: recurringStatus('status').notNull().default('suggested'),
    detectionStats: jsonb('detection_stats'),
    isSubscription: boolean('is_subscription').notNull().default(false),
    lastAmountCents: cents('last_amount_cents'),
    lastSeenDate: day('last_seen_date'),
    ...timestamps,
  },
  (t) => [uniqueIndex('recurring_norm_dir_uq').on(t.descriptionNorm, t.direction)],
);

export const paymentMethod = pgEnum('payment_method', ['pix', 'debit', 'credit']);
export const plannedStatus = pgEnum('planned_status', ['planned', 'done', 'cancelled']);

export const plannedExpense = pgTable('planned_expense', {
  id: id(),
  description: text('description').notNull(),
  amountCents: cents('amount_cents').notNull(),
  date: day('date').notNull(),
  accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
  paymentMethod: paymentMethod('payment_method').notNull(),
  installments: integer('installments').notNull().default(1),
  categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
  status: plannedStatus('status').notNull().default('planned'),
  ...timestamps,
});

export const forecastSource = pgEnum('forecast_source', [
  'income',
  'recurring',
  'planned',
  'installment',
]);
export const forecastStatus = pgEnum('forecast_status', [
  'previsto',
  'realizado',
  'atrasado',
  'cancelado',
  'ajustado',
]);
export const certainty = pgEnum('certainty', ['certain', 'estimated']);

export const forecastEntry = pgTable(
  'forecast_entry',
  {
    id: id(),
    sourceType: forecastSource('source_type').notNull(),
    sourceId: text('source_id').notNull(),
    direction: direction('direction').notNull(),
    accountId: uuid('account_id').references(() => account.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    label: text('label').notNull(),
    expectedDate: day('expected_date').notNull(),
    cashDate: day('cash_date').notNull(),
    windowStart: day('window_start').notNull(),
    windowEnd: day('window_end').notNull(),
    expectedCents: cents('expected_cents').notNull(),
    lowCents: cents('low_cents').notNull(),
    highCents: cents('high_cents').notNull(),
    tolerancePct: real('tolerance_pct').notNull().default(0.05),
    matchPattern: text('match_pattern'),
    status: forecastStatus('status').notNull().default('previsto'),
    certainty: certainty('certainty').notNull().default('certain'),
    calcBreakdown: jsonb('calc_breakdown'),
    /** Valor ajustado pelo usuário (vale no lugar do calculado). */
    userOverrideCents: cents('user_override_cents'),
    generatedAt: ts('generated_at').notNull().defaultNow(),
    generatorVersion: integer('generator_version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('forecast_source_date_uq').on(t.sourceType, t.sourceId, t.expectedDate),
    index('forecast_cash_date_idx').on(t.cashDate),
  ],
);

export const matchedBy = pgEnum('matched_by', ['auto', 'user']);

export const forecastMatch = pgTable(
  'forecast_match',
  {
    id: id(),
    forecastEntryId: uuid('forecast_entry_id')
      .notNull()
      .references(() => forecastEntry.id, { onDelete: 'cascade' }),
    transactionId: uuid('transaction_id')
      .notNull()
      .references(() => transaction.id, { onDelete: 'cascade' }),
    matchedBy: matchedBy('matched_by').notNull(),
    score: real('score'),
    expectedCents: cents('expected_cents').notNull(),
    actualCents: cents('actual_cents').notNull(),
    deltaCents: cents('delta_cents').notNull(),
    matchedAt: ts('matched_at').notNull().defaultNow(),
    /** Desfeito pelo usuário: o par não volta a ser sugerido. */
    unmatchedAt: ts('unmatched_at'),
  },
  (t) => [
    uniqueIndex('forecast_match_tx_active_uq')
      .on(t.transactionId)
      .where(sql`${t.unmatchedAt} is null`),
    uniqueIndex('forecast_match_entry_active_uq')
      .on(t.forecastEntryId)
      .where(sql`${t.unmatchedAt} is null`),
  ],
);
