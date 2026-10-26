ALTER TABLE "node" DROP CONSTRAINT "node_mother_id_node_id_fk";
--> statement-breakpoint
ALTER TABLE "lineage" DROP COLUMN "hang_rule";--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "mother_id";--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "attributes";
