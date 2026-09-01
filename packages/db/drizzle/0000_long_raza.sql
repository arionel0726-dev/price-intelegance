CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"article" text,
	"barcode" text,
	"brand" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"volume" text,
	"image_url" text,
	"price" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
