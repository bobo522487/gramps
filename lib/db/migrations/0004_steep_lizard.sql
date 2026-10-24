ALTER TABLE "project" ADD COLUMN "theme_name" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "surname" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status" text DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "importance" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "ck_project_status" CHECK ("project"."status" in ('planning', 'in_progress', 'completed'));--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "ck_project_importance" CHECK ("project"."importance" between 1 and 5);