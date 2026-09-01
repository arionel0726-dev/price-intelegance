CREATE TABLE "competitor_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"competitor_id" integer NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"price" numeric(10, 2),
	"url" text NOT NULL,
	"available" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"competitor_product_id" integer NOT NULL,
	"source" text NOT NULL,
	"score" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "sex" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "competitor_products" ADD CONSTRAINT "competitor_products_competitor_id_competitors_id_fk" FOREIGN KEY ("competitor_id") REFERENCES "public"."competitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_competitor_product_id_competitor_products_id_fk" FOREIGN KEY ("competitor_product_id") REFERENCES "public"."competitor_products"("id") ON DELETE no action ON UPDATE no action;