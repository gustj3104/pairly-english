CREATE TABLE "dictionary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"query_word" varchar(60) NOT NULL,
	"normalized_word" varchar(60) NOT NULL,
	"meanings" jsonb NOT NULL,
	"pronunciation" varchar(240),
	"audio_url" varchar(2048),
	"source_url" varchar(2048) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "dictionary_entries_normalized_word_unique" UNIQUE("normalized_word"),
	CONSTRAINT "dictionary_entries_query_word_non_blank" CHECK (length(trim("dictionary_entries"."query_word")) > 0),
	CONSTRAINT "dictionary_entries_normalized_word_non_blank" CHECK (length(trim("dictionary_entries"."normalized_word")) > 0),
	CONSTRAINT "dictionary_entries_meanings_non_empty" CHECK (jsonb_array_length("dictionary_entries"."meanings") > 0),
	CONSTRAINT "dictionary_entries_expiry_after_fetch" CHECK ("dictionary_entries"."expires_at" > "dictionary_entries"."fetched_at")
);
--> statement-breakpoint
CREATE TABLE "saved_vocabulary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_key" text NOT NULL,
	"word" varchar(60) NOT NULL,
	"normalized_word" varchar(60) NOT NULL,
	"sense_id" varchar(64) NOT NULL,
	"pronunciation" varchar(240),
	"audio_url" varchar(2048),
	"part_of_speech" varchar(80) NOT NULL,
	"definition" text NOT NULL,
	"example" text,
	"source_url" varchar(2048) NOT NULL,
	"article_id" uuid,
	"context_sentence" varchar(1000),
	"saved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "saved_vocabulary_participant_word_unique" UNIQUE("participant_key","normalized_word"),
	CONSTRAINT "saved_vocabulary_participant_non_blank" CHECK (length(trim("saved_vocabulary"."participant_key")) > 0),
	CONSTRAINT "saved_vocabulary_definition_non_blank" CHECK (length(trim("saved_vocabulary"."definition")) > 0),
	CONSTRAINT "saved_vocabulary_part_of_speech_non_blank" CHECK (length(trim("saved_vocabulary"."part_of_speech")) > 0)
);
--> statement-breakpoint
ALTER TABLE "saved_vocabulary" ADD CONSTRAINT "saved_vocabulary_normalized_word_dictionary_entries_normalized_word_fk" FOREIGN KEY ("normalized_word") REFERENCES "public"."dictionary_entries"("normalized_word") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_vocabulary" ADD CONSTRAINT "saved_vocabulary_article_id_daily_news_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."daily_news_articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dictionary_entries_expires_at_idx" ON "dictionary_entries" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "saved_vocabulary_participant_saved_at_idx" ON "saved_vocabulary" USING btree ("participant_key","saved_at");