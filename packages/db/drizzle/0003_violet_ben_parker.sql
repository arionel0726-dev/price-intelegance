CREATE TABLE "product_barcodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"barcode" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_barcodes_barcode_unique" UNIQUE("barcode")
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "source_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "variant_group_id" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "regular_price" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "product_barcodes" ADD CONSTRAINT "product_barcodes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_source_key_unique" UNIQUE("source_key");