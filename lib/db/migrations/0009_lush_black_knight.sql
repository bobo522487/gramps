-- Hand-reviewed: drizzle-kit emits ADD CONSTRAINT in schema-declaration order,
-- which puts the foreign keys before the unique constraints they reference and
-- fails with 42830 ("no unique constraint matching given keys"). Uniques first.
ALTER TABLE "book_catalog" DROP CONSTRAINT "book_catalog_parent_id_book_catalog_id_fk";--> statement-breakpoint
ALTER TABLE "node" DROP CONSTRAINT "node_parent_id_node_id_fk";--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "uk_book_catalog_org_book_id" UNIQUE("organization_id","book_id","id");--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "uk_folder_org_project_id" UNIQUE("organization_id","project_id","id");--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "uk_node_org_lineage_id" UNIQUE("organization_id","lineage_id","id");--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "fk_catalog_parent_same_book" FOREIGN KEY ("parent_id","organization_id","book_id") REFERENCES "public"."book_catalog"("id","organization_id","book_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "fk_folder_parent_same_project" FOREIGN KEY ("parent_id","organization_id","project_id") REFERENCES "public"."folder"("id","organization_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "fk_node_parent_same_lineage" FOREIGN KEY ("parent_id","organization_id","lineage_id") REFERENCES "public"."node"("id","organization_id","lineage_id") ON DELETE restrict ON UPDATE no action;
