CREATE TYPE "public"."certainty" AS ENUM('certain', 'estimated');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."forecast_mode" AS ENUM('calculated', 'calibrated');--> statement-breakpoint
CREATE TYPE "public"."forecast_source" AS ENUM('income', 'recurring', 'planned', 'installment');--> statement-breakpoint
CREATE TYPE "public"."forecast_status" AS ENUM('previsto', 'realizado', 'atrasado', 'cancelado', 'ajustado');--> statement-breakpoint
CREATE TYPE "public"."income_event_type" AS ENUM('13_1', '13_2', 'vacation', 'plr', 'bonus', 'other');--> statement-breakpoint
CREATE TYPE "public"."income_status" AS ENUM('active', 'paused', 'ended');--> statement-breakpoint
CREATE TYPE "public"."income_type" AS ENUM('clt', 'pj', 'other');--> statement-breakpoint
CREATE TYPE "public"."matched_by" AS ENUM('auto', 'user');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."periodicity" AS ENUM('weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."planned_status" AS ENUM('planned', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recurring_nature" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TYPE "public"."recurring_status" AS ENUM('suggested', 'confirmed', 'ignored');--> statement-breakpoint
CREATE TABLE "forecast_entry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_type" "forecast_source" NOT NULL,
	"source_id" text NOT NULL,
	"direction" "direction" NOT NULL,
	"account_id" uuid,
	"category_id" uuid,
	"label" text NOT NULL,
	"expected_date" date NOT NULL,
	"cash_date" date NOT NULL,
	"window_start" date NOT NULL,
	"window_end" date NOT NULL,
	"expected_cents" bigint NOT NULL,
	"low_cents" bigint NOT NULL,
	"high_cents" bigint NOT NULL,
	"tolerance_pct" real DEFAULT 0.05 NOT NULL,
	"match_pattern" text,
	"status" "forecast_status" DEFAULT 'previsto' NOT NULL,
	"certainty" "certainty" DEFAULT 'certain' NOT NULL,
	"calc_breakdown" jsonb,
	"user_override_cents" bigint,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generator_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "forecast_match" (
	"id" uuid PRIMARY KEY NOT NULL,
	"forecast_entry_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"matched_by" "matched_by" NOT NULL,
	"score" real,
	"expected_cents" bigint NOT NULL,
	"actual_cents" bigint NOT NULL,
	"delta_cents" bigint NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unmatched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "income_event" (
	"id" uuid PRIMARY KEY NOT NULL,
	"income_source_id" uuid NOT NULL,
	"type" "income_event_type" NOT NULL,
	"expected_date" date NOT NULL,
	"gross_cents" bigint,
	"net_cents" bigint,
	"vacation_days" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_salary_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"income_source_id" uuid NOT NULL,
	"gross_cents" bigint NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "income_source" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" "income_type" NOT NULL,
	"employer_name" text,
	"match_pattern" text,
	"account_id" uuid,
	"category_id" uuid,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "income_status" DEFAULT 'active' NOT NULL,
	"payment_rule" jsonb NOT NULL,
	"deductions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"pj_config" jsonb,
	"forecast_mode" "forecast_mode" DEFAULT 'calculated' NOT NULL,
	"calibration_factor" real DEFAULT 1 NOT NULL,
	"prorate_first_month" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_expense" (
	"id" uuid PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid,
	"payment_method" "payment_method" NOT NULL,
	"installments" integer DEFAULT 1 NOT NULL,
	"category_id" uuid,
	"status" "planned_status" DEFAULT 'planned' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_item" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"direction" "direction" NOT NULL,
	"category_id" uuid,
	"account_id" uuid,
	"description_norm" text,
	"match_pattern" text,
	"amount_cents" bigint NOT NULL,
	"tolerance_pct" real DEFAULT 0.05 NOT NULL,
	"nature" "recurring_nature" DEFAULT 'fixed' NOT NULL,
	"periodicity" "periodicity" DEFAULT 'monthly' NOT NULL,
	"anchor_day" integer NOT NULL,
	"anchor_month" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "recurring_status" DEFAULT 'suggested' NOT NULL,
	"detection_stats" jsonb,
	"is_subscription" boolean DEFAULT false NOT NULL,
	"last_amount_cents" bigint,
	"last_seen_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_table" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"payload" jsonb NOT NULL,
	"source_url" text NOT NULL,
	"verified_at" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forecast_entry" ADD CONSTRAINT "forecast_entry_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_entry" ADD CONSTRAINT "forecast_entry_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_match" ADD CONSTRAINT "forecast_match_forecast_entry_id_forecast_entry_id_fk" FOREIGN KEY ("forecast_entry_id") REFERENCES "public"."forecast_entry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_match" ADD CONSTRAINT "forecast_match_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_event" ADD CONSTRAINT "income_event_income_source_id_income_source_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_salary_history" ADD CONSTRAINT "income_salary_history_income_source_id_income_source_id_fk" FOREIGN KEY ("income_source_id") REFERENCES "public"."income_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "income_source" ADD CONSTRAINT "income_source_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_expense" ADD CONSTRAINT "planned_expense_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_item" ADD CONSTRAINT "recurring_item_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_item" ADD CONSTRAINT "recurring_item_account_id_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."account"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_source_date_uq" ON "forecast_entry" USING btree ("source_type","source_id","expected_date");--> statement-breakpoint
CREATE INDEX "forecast_cash_date_idx" ON "forecast_entry" USING btree ("cash_date");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_match_tx_active_uq" ON "forecast_match" USING btree ("transaction_id") WHERE "forecast_match"."unmatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_match_entry_active_uq" ON "forecast_match" USING btree ("forecast_entry_id") WHERE "forecast_match"."unmatched_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "income_salary_from_uq" ON "income_salary_history" USING btree ("income_source_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_norm_dir_uq" ON "recurring_item" USING btree ("description_norm","direction");--> statement-breakpoint
CREATE UNIQUE INDEX "tax_table_kind_from_uq" ON "tax_table" USING btree ("kind","valid_from");