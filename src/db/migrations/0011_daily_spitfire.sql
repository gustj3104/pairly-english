ALTER TABLE "saved_vocabulary" DROP CONSTRAINT "saved_vocabulary_participant_word_unique";--> statement-breakpoint
ALTER TABLE "saved_vocabulary" ADD CONSTRAINT "saved_vocabulary_participant_word_sense_unique" UNIQUE("participant_key","normalized_word","sense_id");
