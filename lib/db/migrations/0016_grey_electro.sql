CREATE TABLE "person_name" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name_type" text NOT NULL,
	"custom_type" text,
	"full_name" text,
	"surname" text,
	"given_name" text,
	"name_prefix" text,
	"name_suffix" text,
	"surname_prefix" text,
	"nickname" text,
	"pinyin" text,
	"romanized" text,
	"language" varchar(35),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_person_name_organization_person_id" UNIQUE("organization_id","person_id","id"),
	CONSTRAINT "ck_person_name_type" CHECK ("person_name"."name_type" in ('birth', 'courtesy', 'art', 'posthumous', 'temple', 'childhood', 'maiden', 'married', 'aka', 'religious', 'professional', 'school', 'official', 'other')),
	CONSTRAINT "ck_person_name_custom_type" CHECK ("person_name"."name_type" <> 'other' or "person_name"."custom_type" is not null)
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"sex" text NOT NULL,
	"living_status" text NOT NULL,
	"living_status_locked" boolean DEFAULT false NOT NULL,
	"privacy_level" text NOT NULL,
	"name_status" text NOT NULL,
	"primary_name_id" uuid,
	"merged_into_id" uuid,
	"sort_key" text,
	"legacy_node_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_person_organization_project_id" UNIQUE("organization_id","project_id","id"),
	CONSTRAINT "ck_person_sex" CHECK ("person"."sex" in ('male', 'female', 'other', 'unknown')),
	CONSTRAINT "ck_person_living_status" CHECK ("person"."living_status" in ('living', 'deceased', 'unknown')),
	CONSTRAINT "ck_person_privacy_level" CHECK ("person"."privacy_level" in ('public', 'restricted', 'private')),
	CONSTRAINT "ck_person_name_status" CHECK ("person"."name_status" in ('known', 'unknown', 'partial')),
	CONSTRAINT "ck_person_not_self_merged" CHECK ("person"."merged_into_id" is distinct from "person"."id")
);
--> statement-breakpoint
ALTER TABLE "person_name" ADD CONSTRAINT "fk_person_name_person" FOREIGN KEY ("organization_id","project_id","person_id") REFERENCES "public"."person"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "fk_person_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "fk_person_merged_into_same_project" FOREIGN KEY ("organization_id","project_id","merged_into_id") REFERENCES "public"."person"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_person_name_type_order" ON "person_name" USING btree ("organization_id","person_id","name_type","sort_order") WHERE "person_name"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_person_name_person" ON "person_name" USING btree ("organization_id","person_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "uk_person_legacy_node" ON "person" USING btree ("organization_id","project_id","legacy_node_id") WHERE "person"."deleted_at" is null and "person"."legacy_node_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_person_project" ON "person" USING btree ("organization_id","project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_person_merged" ON "person" USING btree ("organization_id","project_id","merged_into_id");