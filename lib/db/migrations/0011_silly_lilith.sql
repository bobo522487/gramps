ALTER TABLE "node" DROP CONSTRAINT "node_spouse_of_id_node_id_fk";
--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "fk_node_spouse_same_lineage" FOREIGN KEY ("spouse_of_id","organization_id","lineage_id") REFERENCES "public"."node"("id","organization_id","lineage_id") ON DELETE restrict ON UPDATE no action;