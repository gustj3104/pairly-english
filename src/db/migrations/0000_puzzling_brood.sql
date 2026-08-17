CREATE TYPE "public"."credit_feature" AS ENUM('reflection_comparison', 'grammar_feedback', 'vocabulary_extraction', 'news_processing', 'reconciliation_adjustment');--> statement-breakpoint
CREATE TYPE "public"."credit_status" AS ENUM('reserved', 'completed', 'failed', 'released');--> statement-breakpoint
CREATE TABLE "credit_periods" (
	"billing_month" varchar(7) PRIMARY KEY NOT NULL,
	"committed_credits" integer DEFAULT 0 NOT NULL,
	"reserved_credits" integer DEFAULT 0 NOT NULL,
	"provider_reported_credits" integer DEFAULT 0 NOT NULL,
	"exhausted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"retry_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_usage_records" ADD CONSTRAINT "credit_usage_records_billing_month_credit_periods_billing_month_fk" FOREIGN KEY ("billing_month") REFERENCES "public"."credit_periods"("billing_month") ON DELETE no action ON UPDATE no action;