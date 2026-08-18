CREATE TYPE "public"."reflection_status" AS ENUM('submitted');--> statement-breakpoint
CREATE TABLE "reflections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_date" date NOT NULL,
	"participant_key" text NOT NULL,
	"display_name" text NOT NULL,
	"content" text NOT NULL,
	"status" "reflection_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reflections_study_date_participant_key_unique" UNIQUE("study_date","participant_key"),
	CONSTRAINT "reflections_display_name_non_blank" CHECK (length(trim("reflections"."display_name")) > 0),
	CONSTRAINT "reflections_content_non_blank" CHECK (length(trim("reflections"."content")) > 0)
);
--> statement-breakpoint
CREATE TABLE "study_days" (
	"study_date" date PRIMARY KEY NOT NULL,
	"article_id" text NOT NULL,
	"article_title" text NOT NULL,
	"article_source_url" text,
	"article_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reflections" ADD CONSTRAINT "reflections_study_date_study_days_study_date_fk" FOREIGN KEY ("study_date") REFERENCES "public"."study_days"("study_date") ON DELETE no action ON UPDATE no action;