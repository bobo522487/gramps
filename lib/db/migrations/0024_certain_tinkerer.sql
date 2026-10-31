ALTER TABLE "node" DROP CONSTRAINT "ck_node_generation_lte_level";--> statement-breakpoint
ALTER TABLE "node" DROP CONSTRAINT "ck_node_depth_eq_level";--> statement-breakpoint
DROP INDEX "idx_node_lineage_depth";--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "depth";--> statement-breakpoint
ALTER TABLE "node" DROP COLUMN "level";--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "ck_node_generation_gte_tree_depth" CHECK ("node"."generation" >= case when "node"."path" is null then 1 else nlevel("node"."path") end);