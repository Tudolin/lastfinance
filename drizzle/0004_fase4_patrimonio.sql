CREATE TYPE "public"."goal_status" AS ENUM('active', 'done', 'archived');--> statement-breakpoint
CREATE TABLE "goal" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"target_cents" bigint NOT NULL,
	"target_date" date,
	"investment_id" uuid,
	"manual_saved_cents" bigint DEFAULT 0 NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshot" (
	"date" date PRIMARY KEY NOT NULL,
	"cash_cents" bigint NOT NULL,
	"investments_cents" bigint NOT NULL,
	"card_debt_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"breakdown" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_history" (
	"series" text NOT NULL,
	"date" date NOT NULL,
	"rate" real NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal" ADD CONSTRAINT "goal_investment_id_investment_id_fk" FOREIGN KEY ("investment_id") REFERENCES "public"."investment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rate_history_series_date_uq" ON "rate_history" USING btree ("series","date");