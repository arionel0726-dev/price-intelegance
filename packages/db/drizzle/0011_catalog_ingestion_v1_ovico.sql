CREATE TABLE "catalog_sync_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"brand_source_id" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"pages_processed" integer DEFAULT 0 NOT NULL,
	"discovered" integer DEFAULT 0 NOT NULL,
	"inserted" integer DEFAULT 0 NOT NULL,
	"updated" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"error_summary" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	CONSTRAINT "catalog_sync_runs_status_check" CHECK ("catalog_sync_runs"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "competitor_brand_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"competitor_id" integer NOT NULL,
	"source_url" text NOT NULL,
	"external_name" text,
	"external_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'needs_review' NOT NULL,
	"last_synced_at" timestamp,
	"last_sync_status" text,
	"last_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_brand_sources_competitor_id_source_url_unique" UNIQUE("competitor_id","source_url"),
	CONSTRAINT "competitor_brand_sources_status_check" CHECK ("competitor_brand_sources"."status" IN ('confirmed', 'missing', 'needs_review'))
);
--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "old_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "concentration" text;--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "shade" text;--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "is_approximate_price" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "brand_id" text;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "first_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "last_seen_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "last_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "catalog_sync_runs" ADD CONSTRAINT "catalog_sync_runs_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_sync_runs" ADD CONSTRAINT "catalog_sync_runs_brand_source_id_competitor_brand_sources_id_fk" FOREIGN KEY ("brand_source_id") REFERENCES "public"."competitor_brand_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_brand_sources" ADD CONSTRAINT "competitor_brand_sources_brand_id_brands_canonical_key_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("canonical_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_brand_sources" ADD CONSTRAINT "competitor_brand_sources_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_sync_runs_brand_source_idx" ON "catalog_sync_runs" USING btree ("brand_source_id","started_at");--> statement-breakpoint
CREATE INDEX "competitor_brand_sources_brand_competitor_idx" ON "competitor_brand_sources" USING btree ("brand_id","competitor_id");--> statement-breakpoint
ALTER TABLE "competitor_products" ADD CONSTRAINT "competitor_products_brand_id_brands_canonical_key_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("canonical_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "competitor_products_brand_id_idx" ON "competitor_products" USING btree ("brand_id");