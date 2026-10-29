CREATE TABLE "family" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"union_type" varchar(20) DEFAULT 'unknown' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_family_organization_project_id" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "ck_family_union_type" CHECK ("family"."union_type" in ('marriage', 'cohabitation', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "family_child" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"parentage_type" varchar(20) DEFAULT 'birth' NOT NULL,
	"is_primary" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_family_child_organization_project_id" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "ck_family_child_parentage_type" CHECK ("family_child"."parentage_type" in ('birth', 'adoptive', 'foster', 'step', 'traditional', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "family_partner" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"partner_order" smallint DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'unknown' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_family_partner_organization_project_id" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "ck_family_partner_role" CHECK ("family_partner"."role" in ('blood', 'spouse')),
	CONSTRAINT "ck_family_partner_status" CHECK ("family_partner"."status" in ('current', 'divorced', 'widowed', 'separated', 'unknown'))
);
--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "allow_consanguineous_marriage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "family" ADD CONSTRAINT "fk_family_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_child" ADD CONSTRAINT "fk_family_child_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_child" ADD CONSTRAINT "fk_family_child_family" FOREIGN KEY ("organization_id","project_id","family_id") REFERENCES "public"."family"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_child" ADD CONSTRAINT "fk_family_child_person" FOREIGN KEY ("organization_id","project_id","person_id") REFERENCES "public"."person"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_partner" ADD CONSTRAINT "fk_family_partner_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_partner" ADD CONSTRAINT "fk_family_partner_family" FOREIGN KEY ("organization_id","project_id","family_id") REFERENCES "public"."family"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_partner" ADD CONSTRAINT "fk_family_partner_person" FOREIGN KEY ("organization_id","project_id","person_id") REFERENCES "public"."person"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_family_project" ON "family" USING btree ("organization_id","project_id","deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_family_child_family_person" ON "family_child" USING btree ("organization_id","family_id","person_id") WHERE "family_child"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_family_child_person" ON "family_child" USING btree ("organization_id","project_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_family_partner_family_person" ON "family_partner" USING btree ("organization_id","family_id","person_id") WHERE "family_partner"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_family_partner_person" ON "family_partner" USING btree ("organization_id","project_id","person_id");