CREATE TYPE "public"."ai_batch_status" AS ENUM('submitted', 'ended', 'applied', 'failed');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('user', 'rule', 'merchant', 'ai', 'link');--> statement-breakpoint
CREATE TYPE "public"."merchant_source" AS ENUM('ai', 'user');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."rule_origin" AS ENUM('user', 'correction');--> statement-breakpoint
CREATE TABLE "ai_batch_job" (
	"id" uuid PRIMARY KEY NOT NULL,
	"anthropic_batch_id" text NOT NULL,
	"feature" text NOT NULL,
	"status" "ai_batch_status" DEFAULT 'submitted' NOT NULL,
	"item_count" integer NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "ai_batch_job_anthropic_batch_id_unique" UNIQUE("anthropic_batch_id")
);
--> statement-breakpoint
CREATE TABLE "ai_usage_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"feature" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"batch" boolean DEFAULT false NOT NULL,
	"cost_micros_usd" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"rollover" boolean DEFAULT false NOT NULL,
	"rolled_in_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorization_rule" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"origin" "rule_origin" DEFAULT 'user' NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"last_hit_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_suggestion" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"parent_name" text,
	"examples" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_suggestion_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "merchant" (
	"id" uuid PRIMARY KEY NOT NULL,
	"description_norm" text NOT NULL,
	"display_name" text,
	"category_id" uuid,
	"nature" text,
	"looks_recurring" boolean,
	"periodicity" text,
	"confidence" real,
	"source" "merchant_source" NOT NULL,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_description_norm_unique" UNIQUE("description_norm")
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"suggested" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transaction_split" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_cents" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "kind" "category_kind" DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "category" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "category_source" "category_source";--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "category_confidence" real;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "rule_id" uuid;--> statement-breakpoint
ALTER TABLE "budget" ADD CONSTRAINT "budget_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_transaction_id_transaction_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transaction"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_split" ADD CONSTRAINT "transaction_split_category_id_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_at_idx" ON "ai_usage_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_cat_month_uq" ON "budget" USING btree ("category_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "review_pending_uq" ON "review_queue" USING btree ("transaction_id") WHERE "review_queue"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "split_tx_idx" ON "transaction_split" USING btree ("transaction_id");--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_slug_unique" UNIQUE("slug");