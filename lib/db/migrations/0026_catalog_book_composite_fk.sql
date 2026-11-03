-- Composite FK: catalog.organization_id must match book.organization_id.
-- Replaces book_catalog_book_id_book_id_fk (single-column, ON DELETE CASCADE).
ALTER TABLE "book_catalog" DROP CONSTRAINT "book_catalog_book_id_book_id_fk";
--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "fk_catalog_book" FOREIGN KEY ("organization_id","book_id") REFERENCES "public"."book"("organization_id","id") ON DELETE restrict ON UPDATE no action;