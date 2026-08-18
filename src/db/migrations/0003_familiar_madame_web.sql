CREATE TYPE "public"."comparison_status" AS ENUM('processing', 'completed', 'failed', 'reconciliation_pending');--> statement-breakpoint
CREATE TABLE "study_day_comparisons" (
	"study_date" date PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "comparison_status" NOT NULL,
	"model" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"result" jsonb,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "study_day_comparisons_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "study_day_comparisons_completed_has_result" CHECK (("study_day_comparisons"."status" = 'completed') = ("study_day_comparisons"."result" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "study_day_comparisons" ADD CONSTRAINT "study_day_comparisons_study_date_study_days_study_date_fk" FOREIGN KEY ("study_date") REFERENCES "public"."study_days"("study_date") ON DELETE no action ON UPDATE no action;