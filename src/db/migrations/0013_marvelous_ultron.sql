CREATE TABLE "study_day_discussions" (
	"study_date" date PRIMARY KEY NOT NULL,
	"transcript" jsonb,
	"transcript_updated_at" timestamp with time zone,
	"transcript_updated_by" text,
	"transcript_fingerprint" text,
	"topic_index" integer,
	"feedback_request_id" uuid,
	"feedback_status" "comparison_status",
	"feedback_model" text,
	"feedback_input_fingerprint" text,
	"feedback_result" jsonb,
	"feedback_error_code" text,
	"feedback_started_at" timestamp with time zone,
	"feedback_completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "study_day_discussions_feedback_request_id_unique" UNIQUE("feedback_request_id"),
	CONSTRAINT "study_day_discussions_completed_has_result" CHECK (("study_day_discussions"."feedback_status" = 'completed') = ("study_day_discussions"."feedback_result" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "study_day_discussions" ADD CONSTRAINT "study_day_discussions_study_date_study_days_study_date_fk" FOREIGN KEY ("study_date") REFERENCES "public"."study_days"("study_date") ON DELETE no action ON UPDATE no action;