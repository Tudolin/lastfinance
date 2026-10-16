CREATE TYPE "public"."account_kind" AS ENUM('checking', 'savings', 'credit_card');--> statement-breakpoint
CREATE TYPE "public"."backfill_state" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."bill_status" AS ENUM('open', 'closed', 'paid', 'partial', 'overdue', 'projected');--> statement-breakpoint
CREATE TYPE "public"."challenge_purpose" AS ENUM('webauthn_register', 'webauthn_login', 'webauthn_stepup', 'totp_login');--> statement-breakpoint
CREATE TYPE "public"."kind_source" AS ENUM('user', 'rule', 'auto');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('running', 'success', 'partial', 'error');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('webhook', 'cron', 'manual', 'backfill', 'connect');--> statement-breakpoint
CREATE TYPE "public"."tx_kind" AS ENUM('expense', 'income', 'internal_transfer', 'investment_in', 'investment_out', 'card_payment', 'refund', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."tx_source" AS ENUM('pluggy', 'import', 'manual');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('PENDING', 'POSTED');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'enqueued', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"pluggy_account_id" text NOT NULL,
	"kind" "account_kind" NOT NULL,
	"name" text NOT NULL,
	"display_name" text,
	"number_masked" text,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"balance_cents" bigint DEFAULT 0 NOT NULL,
	"balance_at" timestamp with time zone,
	"credit_limit_cents" bigint,
	"available_limit_cents" bigint,
	"closing_day" integer,
	"due_day" integer,
	"closing_day_source" text,
	"include_in_cash" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_pluggy_account_id_unique" UNIQUE("pluggy_account_id")
);
--> statement-breakpoint
CREATE TABLE "app_user" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_attempt" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"success" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_challenge" (
	"id" uuid PRIMARY KEY NOT NULL,
	"purpose" "challenge_purpose" NOT NULL,
	"challenge" text NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"icon" text,
	"color" text,
	"pluggy_category_id" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_pluggy_category_id_unique" UNIQUE("pluggy_category_id")
);
--> statement-breakpoint
CREATE TABLE "credit_card_bill" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"pluggy_bill_id" text,
	"closing_date" date,
	"due_date" date NOT NULL,
	"total_cents" bigint NOT NULL,
	"minimum_payment_cents" bigint,
	"allows_installments" boolean,
	"finance_charges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "bill_status" DEFAULT 'open' NOT NULL,
	"paid_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_card_bill_pluggy_bill_id_unique" UNIQUE("pluggy_bill_id")
);
--> statement-breakpoint
CREATE TABLE "institution_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"pluggy_item_id" text NOT NULL,
	"connector_id" integer NOT NULL,
	"connector_name" text NOT NULL,
	"connector_image_url" text,
	"is_open_finance" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"execution_status" text,
	"status_detail" jsonb,
	"error_code" text,
	"error_message" text,
	"consent_expires_at" timestamp with time zone,
	"pluggy_last_updated_at" timestamp with time zone,
	"next_auto_sync_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"backfill_state" "backfill_state" DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institution_connection_pluggy_item_id_unique" UNIQUE("pluggy_item_id")
);
--> statement-breakpoint
CREATE TABLE "investment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"pluggy_investment_id" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text,
	"name" text NOT NULL,
	"issuer" text,
	"rate" real,
	"rate_type" text,
	"fixed_annual_rate" real,
	"gross_cents" bigint,
	"net_cents" bigint NOT NULL,
	"taxes_cents" bigint,
	"profit_cents" bigint,
	"issue_date" date,
	"due_date" date,
	"status" text,
	"balance_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_pluggy_investment_id_unique" UNIQUE("pluggy_investment_id")
);
--> statement-breakpoint
CREATE TABLE "investment_transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"investment_id" uuid NOT NULL,
	"pluggy_id" text NOT NULL,
	"type" text,
	"movement_type" text NOT NULL,
	"description" text,
	"date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"net_amount_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_transaction_pluggy_id_unique" UNIQUE("pluggy_id")
);
--> statement-breakpoint
CREATE TABLE "own_document" (
	"doc_hash" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recovery_code" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recovery_code_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"ip_prefix" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlocked_until" timestamp with time zone NOT NULL,
	"step_up_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "sync_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid,
	"trigger" "sync_trigger" NOT NULL,
	"job" text NOT NULL,
	"status" "sync_status" DEFAULT 'running' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"run_id" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"pluggy_id" text,
	"provider_id" text,
	"provider_code" text,
	"fingerprint" text NOT NULL,
	"source" "tx_source" DEFAULT 'pluggy' NOT NULL,
	"src_description" text NOT NULL,
	"src_description_raw" text,
	"description_norm" text NOT NULL,
	"user_description" text,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"type" text NOT NULL,
	"status" "tx_status" DEFAULT 'POSTED' NOT NULL,
	"operation_type" text,
	"date" date NOT NULL,
	"competence_date" date NOT NULL,
	"cash_date" date NOT NULL,
	"bill_id" uuid,
	"pluggy_bill_id" text,
	"installment_number" integer,
	"installment_total" integer,
	"kind" "tx_kind" DEFAULT 'expense' NOT NULL,
	"kind_source" "kind_source" DEFAULT 'auto' NOT NULL,
	"kind_confidence" real DEFAULT 0 NOT NULL,
	"kind_reason" text,
	"user_kind" "tx_kind",
	"linked_transaction_id" uuid,
	"paid_bill_id" uuid,
	"refund_of_transaction_id" uuid,
	"category_id" uuid,
	"notes" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"counterparty_doc_hash" text,
	"src_payload" jsonb,
	"last_seen_run" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_pluggy_id_unique" UNIQUE("pluggy_id")
);
--> statement-breakpoint
CREATE TABLE "webauthn_credential" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" "bytea" NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"device_name" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_credential_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"event" text NOT NULL,
	"item_id" text,
	"payload" jsonb NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enqueued_at" timestamp with time zone,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_event_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_connection_id_institution_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."institution_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_challenge" ADD CONSTRAINT "auth_challenge_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_card_bill" ADD CONSTRAINT "credit_card_bill_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment" ADD CONSTRAINT "investment_connection_id_institution_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."institution_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_transaction" ADD CONSTRAINT "investment_transaction_investment_id_investment_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_code" ADD CONSTRAINT "recovery_code_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_log" ADD CONSTRAINT "sync_log_connection_id_institution_connection_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."institution_connection"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_bill_id_credit_card_bill_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."credit_card_bill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_paid_bill_id_credit_card_bill_id_fk" FOREIGN KEY ("paid_bill_id") REFERENCES "public"."credit_card_bill"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_credential" ADD CONSTRAINT "webauthn_credential_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_attempt_identifier_at_idx" ON "auth_attempt" USING btree ("identifier","at");--> statement-breakpoint
CREATE INDEX "bill_account_due_idx" ON "credit_card_bill" USING btree ("account_id","due_date");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_log_started_idx" ON "sync_log" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "tx_account_date_idx" ON "transaction" USING btree ("account_id","date");--> statement-breakpoint
CREATE INDEX "tx_cash_date_idx" ON "transaction" USING btree ("cash_date");--> statement-breakpoint
CREATE INDEX "tx_competence_date_idx" ON "transaction" USING btree ("competence_date");--> statement-breakpoint
CREATE INDEX "tx_fingerprint_idx" ON "transaction" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_provider_id_uq" ON "transaction" USING btree ("account_id","provider_id") WHERE "transaction"."provider_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_status_idx" ON "webhook_event" USING btree ("status","received_at");