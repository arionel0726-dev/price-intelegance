CREATE TABLE "competitor_product_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_product_id" integer NOT NULL,
	"external_id" text NOT NULL,
	"label" text,
	"volume" text,
	"price" numeric(10, 2),
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "competitor_product_variants_competitor_product_id_external_id_unique" UNIQUE("competitor_product_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "matches" DROP CONSTRAINT "matches_competitor_product_id_competitor_products_id_fk";
--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "external_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "brand" text;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD COLUMN "currency" text DEFAULT 'MDL' NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "competitor_product_variant_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "competitor_product_variants" ADD CONSTRAINT "competitor_product_variants_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competitor_product_variant_id_competitor_product_variants_id_fk" FOREIGN KEY ("competitor_product_variant_id") REFERENCES "public"."competitor_product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_products" DROP COLUMN "price";--> statement-breakpoint
ALTER TABLE "competitor_products" DROP COLUMN "available";--> statement-breakpoint
ALTER TABLE "matches" DROP COLUMN "competitor_product_id";--> statement-breakpoint
ALTER TABLE "competitor_products" ADD CONSTRAINT "competitor_products_competitor_id_external_id_unique" UNIQUE("competitor_id","external_id");--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_domain_unique" UNIQUE("domain");