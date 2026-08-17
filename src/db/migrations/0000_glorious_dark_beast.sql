CREATE TYPE "public"."credit_feature" AS ENUM('reflection_comparison', 'grammar_feedback', 'vocabulary_extraction', 'news_processing', 'reconciliation_adjustment');--> statement-breakpoint
CREATE TYPE "public"."credit_status" AS ENUM('reserved', 'completed', 'failed', 'released', 'reconciliation_pending');--> statement-breakpoint
CREATE TABLE "credit_periods" (
	"billing_month" varchar(7) PRIMARY KEY NOT NULL,
	"committed_credits" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"provider_reported_credits" integer DEFAULT 0 NOT NULL,
	"exhausted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_periods_committed_credits_non_negative" CHECK ("credit_periods"."committed_credits" >= 0),
	CONSTRAINT "credit_periods_reserved_credits_non_negative" CHECK ("credit_periods"."reserved_credits" >= 0),
	CONSTRAINT "credit_periods_provider_reported_credits_non_negative" CHECK ("credit_periods"."provider_reported_credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_usage_records" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"billing_month" varchar(7) NOT NULL,
	"feature" "credit_feature" NOT NULL,
	"model" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"credits_reserved" integer NOT NULL,
	"credits_used" integer,
	"status" "credit_status" NOT NULL,
	"error_code" text,
	"user_ref" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "credit_usage_records_input_tokens_non_negative" CHECK ("credit_usage_records"."input_tokens" >= 0),
	CONSTRAINT "credit_usage_records_output_tokens_non_negative" CHECK ("credit_usage_records"."output_tokens" >= 0),
	CONSTRAINT "credit_usage_records_credits_reserved_non_negative" CHECK ("credit_usage_records"."credits_reserved" >= 0),
	CONSTRAINT "credit_usage_records_credits_used_non_negative" CHECK ("credit_usage_records"."credits_used" IS NULL OR "credit_usage_records"."credits_used" >= 0),
	CONSTRAINT "credit_usage_records_retry_count_non_negative" CHECK ("credit_usage_records"."retry_count" >= 0),
	CONSTRAINT "credit_usage_records_reconciliation_pending_has_error_code" CHECK ("credit_usage_records"."status" != 'reconciliation_pending' OR "credit_usage_records"."error_code" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "credit_usage_records" ADD CONSTRAINT "credit_usage_records_billing_month_credit_periods_billing_month_fk" FOREIGN KEY ("billing_month") REFERENCES "public"."credit_periods"("billing_month") ON DELETE no action ON UPDATE no action;