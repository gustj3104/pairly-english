ALTER TABLE "dictionary_entries" ADD COLUMN "cache_schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "saved_vocabulary" ADD COLUMN "korean_translations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "dictionary_entries" ADD CONSTRAINT "dictionary_entries_cache_schema_version_positive" CHECK ("dictionary_entries"."cache_schema_version" > 0);--> statement-breakpoint
ALTER TABLE "saved_vocabulary" ADD CONSTRAINT "saved_vocabulary_korean_translations_array" CHECK (jsonb_typeof("saved_vocabulary"."korean_translations") = 'array');