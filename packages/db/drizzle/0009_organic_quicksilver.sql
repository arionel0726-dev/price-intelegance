ALTER TABLE "discovery_candidates" ADD COLUMN "ai_model" text;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_total_tokens" integer;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_estimated_cost_usd" numeric(10, 6);--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD COLUMN "ai_processing_at" timestamp;--> statement-breakpoint
CREATE INDEX "discovery_candidates_ai_claim_idx" ON "discovery_candidates" USING btree ("id") WHERE "discovery_candidates"."review_status" = 'pending' AND "discovery_candidates"."ai_verdict" IS NULL;