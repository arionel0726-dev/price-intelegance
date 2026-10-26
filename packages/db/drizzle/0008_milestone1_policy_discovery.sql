CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"canonical_key" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"visible_in_catalog" boolean DEFAULT true NOT NULL,
	"makeup_discovery_enabled" boolean DEFAULT true NOT NULL,
	"ovico_discovery_enabled" boolean DEFAULT true NOT NULL,
	"price_monitoring_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"competitor_id" integer NOT NULL,
	"status" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp NOT NULL,
	"last_job_run_id" integer,
	"last_error" text,
	"retry_eligible_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_attempts_product_id_competitor_id_unique" UNIQUE("product_id","competitor_id"),
	CONSTRAINT "discovery_attempts_status_check" CHECK ("discovery_attempts"."status" IN ('processing', 'no_match', 'pending_review', 'error'))
);
--> statement-breakpoint
CREATE TABLE "discovery_candidates" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"competitor_id" integer NOT NULL,
	"competitor_product_variant_id" integer NOT NULL,
	"job_run_id" integer,
	"snapshot_title" text NOT NULL,
	"snapshot_variant_label" text,
	"snapshot_variant_volume" text,
	"snapshot_price" numeric(10, 2),
	"snapshot_url" text NOT NULL,
	"snapshot_image_url" text,
	"rule_score" integer NOT NULL,
	"rule_decision" text NOT NULL,
	"rule_signals" jsonb NOT NULL,
	"ai_verdict" text,
	"ai_confidence" numeric(3, 2),
	"ai_reason" text,
	"ai_raw_response" jsonb,
	"ai_evaluated_at" timestamp,
	"ai_threshold_used" numeric(3, 2),
	"review_status" text DEFAULT 'not_required' NOT NULL,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"review_note" text,
	"outcome" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_candidates_product_id_competitor_id_competitor_product_variant_id_unique" UNIQUE("product_id","competitor_id","competitor_product_variant_id"),
	CONSTRAINT "discovery_candidates_ai_verdict_check" CHECK ("discovery_candidates"."ai_verdict" IS NULL OR "discovery_candidates"."ai_verdict" IN ('approve', 'reject')),
	CONSTRAINT "discovery_candidates_review_status_check" CHECK ("discovery_candidates"."review_status" IN ('not_required', 'pending', 'approved', 'rejected')),
	CONSTRAINT "discovery_candidates_outcome_check" CHECK ("discovery_candidates"."outcome" IS NULL OR "discovery_candidates"."outcome" IN ('ai_auto_matched', 'manual_approved', 'manual_rejected'))
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_run_id" integer NOT NULL,
	"product_id" integer,
	"event_type" text NOT NULL,
	"message" text,
	"data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"job_type" text DEFAULT 'discovery' NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"params" jsonb NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"stop_requested_at" timestamp,
	"stop_reason" text,
	"failure_class" text,
	"eligible_at_start" integer,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"auto_count" integer DEFAULT 0 NOT NULL,
	"ai_auto_count" integer DEFAULT 0 NOT NULL,
	"ai_review_count" integer DEFAULT 0 NOT NULL,
	"no_match_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"current_product_id" integer,
	"current_product_started_at" timestamp,
	"worker_id" text,
	"heartbeat_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"error" text,
	CONSTRAINT "job_runs_mode_check" CHECK ("job_runs"."mode" IN ('limited', 'continuous')),
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" IN ('queued', 'running', 'stopping', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "job_runs_failure_class_check" CHECK ("job_runs"."failure_class" IS NULL OR "job_runs"."failure_class" IN ('operational', 'application'))
);
--> statement-breakpoint
CREATE TABLE "known_placeholder_images" (
	"image_url" text PRIMARY KEY NOT NULL,
	"note" text,
	"confirmed_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_by" text
);
--> statement-breakpoint
CREATE TABLE "product_policy_overrides" (
	"product_id" integer PRIMARY KEY NOT NULL,
	"catalog_enabled_override" boolean,
	"discovery_enabled_override" boolean,
	"price_monitoring_enabled_override" boolean,
	"exclusion_reason" text,
	"reason_note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "product_policy_overrides_exclusion_reason_check" CHECK ("product_policy_overrides"."exclusion_reason" IS NULL OR "product_policy_overrides"."exclusion_reason" IN ('duplicate', 'discontinued', 'bad_data', 'wrong_product', 'internal', 'other'))
);
--> statement-breakpoint
ALTER TABLE "discovery_attempts" ADD CONSTRAINT "discovery_attempts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_attempts" ADD CONSTRAINT "discovery_attempts_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_attempts" ADD CONSTRAINT "discovery_attempts_last_job_run_id_job_runs_id_fk" FOREIGN KEY ("last_job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_competitor_product_variant_id_competitor_product_variants_id_fk" FOREIGN KEY ("competitor_product_variant_id") REFERENCES "public"."competitor_product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_run_id_job_runs_id_fk" FOREIGN KEY ("job_run_id") REFERENCES "public"."job_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_current_product_id_products_id_fk" FOREIGN KEY ("current_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_policy_overrides" ADD CONSTRAINT "product_policy_overrides_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_attempts_competitor_status_idx" ON "discovery_attempts" USING btree ("competitor_id","status");--> statement-breakpoint
CREATE INDEX "discovery_attempts_retry_idx" ON "discovery_attempts" USING btree ("competitor_id","retry_eligible_at");--> statement-breakpoint
CREATE INDEX "discovery_attempts_last_job_run_idx" ON "discovery_attempts" USING btree ("last_job_run_id");--> statement-breakpoint
CREATE INDEX "discovery_candidates_pending_idx" ON "discovery_candidates" USING btree ("competitor_id") WHERE "discovery_candidates"."review_status" = 'pending';--> statement-breakpoint
CREATE INDEX "discovery_candidates_job_run_idx" ON "discovery_candidates" USING btree ("job_run_id");--> statement-breakpoint
CREATE INDEX "job_events_job_run_idx" ON "job_events" USING btree ("job_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_runs_active_per_competitor" ON "job_runs" USING btree ("competitor_id") WHERE "job_runs"."status" IN ('queued', 'running', 'stopping');--> statement-breakpoint
CREATE INDEX "job_runs_status_idx" ON "job_runs" USING btree ("status");--> statement-breakpoint
-- Milestone 1 app_settings defaults - AI stage is OFF until the AI
-- milestone explicitly turns it on; threshold seeded at the agreed 0.90
-- starting value. ON CONFLICT DO NOTHING so re-running this migration (or a
-- future hand-edited settings row) is never clobbered.
INSERT INTO "app_settings" ("key", "value") VALUES ('ai.enabled', 'false') ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
INSERT INTO "app_settings" ("key", "value") VALUES ('ai.auto_confirm_threshold', '0.90') ON CONFLICT ("key") DO NOTHING;