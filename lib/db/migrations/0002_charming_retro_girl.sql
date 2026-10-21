ALTER TABLE "teams" RENAME TO "organizations";
--> statement-breakpoint
ALTER TABLE "team_members" RENAME TO "org_members";
--> statement-breakpoint
ALTER TABLE "organizations" RENAME CONSTRAINT "teams_stripe_customer_id_unique" TO "organizations_stripe_customer_id_unique";
--> statement-breakpoint
ALTER TABLE "organizations" RENAME CONSTRAINT "teams_stripe_subscription_id_unique" TO "organizations_stripe_subscription_id_unique";
--> statement-breakpoint
ALTER TABLE "org_members" RENAME CONSTRAINT "team_members_user_id_users_id_fk" TO "org_members_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "org_members" RENAME CONSTRAINT "team_members_team_id_teams_id_fk" TO "org_members_org_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "activity_logs" RENAME CONSTRAINT "activity_logs_team_id_teams_id_fk" TO "activity_logs_org_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "invitations" RENAME CONSTRAINT "invitations_team_id_teams_id_fk" TO "invitations_org_id_organizations_id_fk";
--> statement-breakpoint
ALTER TABLE "org_members" RENAME COLUMN "team_id" TO "org_id";
--> statement-breakpoint
ALTER TABLE "activity_logs" RENAME COLUMN "team_id" TO "org_id";
--> statement-breakpoint
ALTER TABLE "invitations" RENAME COLUMN "team_id" TO "org_id";
--> statement-breakpoint
UPDATE "activity_logs" SET "action" = CASE "action" WHEN 'CREATE_TEAM' THEN 'CREATE_ORG' WHEN 'REMOVE_TEAM_MEMBER' THEN 'REMOVE_ORG_MEMBER' WHEN 'INVITE_TEAM_MEMBER' THEN 'INVITE_ORG_MEMBER' ELSE "action" END;
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"region" varchar(60) DEFAULT 'us-east-1' NOT NULL,
	"tier" varchar(20) DEFAULT 'hobby' NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"health" varchar(20) DEFAULT 'HEALTHY' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_deployed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"key_hash" text NOT NULL,
	"type" varchar(20) DEFAULT 'anon' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_idx" ON "projects" USING btree ("org_id","slug");
