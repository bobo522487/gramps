DROP TABLE "api_keys" CASCADE;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "slug" varchar(20);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ref" varchar(20);