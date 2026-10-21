ALTER TABLE "activity_logs" ALTER COLUMN "org_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "activity_logs_org_idx" ON "activity_logs" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "activity_logs_user_idx" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_org_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_pending_org_email_idx" ON "invitations" USING btree ("org_id",lower("email")) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_idx" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_status_check" CHECK ("invitations"."status" in ('pending', 'accepted'));--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_role_check" CHECK ("org_members"."role" in ('owner', 'member'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('ACTIVE', 'PAUSED', 'ARCHIVED'));--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_health_check" CHECK ("projects"."health" in ('HEALTHY', 'DEGRADED'));