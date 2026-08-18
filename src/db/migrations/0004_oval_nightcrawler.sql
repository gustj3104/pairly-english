ALTER TYPE "public"."credit_feature" ADD VALUE 'daily_news' BEFORE 'grammar_feedback';--> statement-breakpoint
CREATE TABLE "daily_news_articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"study_date" date NOT NULL,
	"title" varchar(240) NOT NULL,
	"source_name" varchar(120) NOT NULL,
	"source_url" varchar(2048) NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"summary" varchar(1200) NOT NULL,
	"content" text NOT NULL,
	"vocabulary" jsonb NOT NULL,
	CONSTRAINT "daily_news_articles_study_date_unique" UNIQUE("study_date")
);
