CREATE EXTENSION IF NOT EXISTS ltree;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.generate_public_id() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT substr(replace(gen_random_uuid()::text, '-', ''), 1, 20);
$$;
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text
);
--> statement-breakpoint
CREATE TABLE "article" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" text NOT NULL,
	"kind" text,
	"content" jsonb NOT NULL,
	"plain_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_article_organization_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "book_catalog" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"book_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"section" smallint NOT NULL,
	"article_id" uuid,
	"lineage_id" uuid,
	"sort" integer DEFAULT 0 NOT NULL,
	"hide" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_catalog_section" CHECK ("book_catalog"."section" in (1, 2, 3)),
	CONSTRAINT "ck_catalog_one_target" CHECK (num_nonnulls("book_catalog"."article_id", "book_catalog"."lineage_id") <= 1)
);
--> statement-breakpoint
CREATE TABLE "book" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"surname" text NOT NULL,
	"hall_code" text,
	"volume_no" text,
	"author" text,
	"compiled_at" text,
	"cover_spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"back_cover_spec" jsonb,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_book_organization_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "folder" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" smallint NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_folder_kind" CHECK ("folder"."kind" in (0, 1, 2))
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_invite_role" CHECK ("invite"."role" in ('admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "lineage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"surname" text NOT NULL,
	"hall_code" text,
	"generation_words" jsonb,
	"hang_rule" jsonb,
	"node_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_lineage_organization_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "node" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"parent_id" uuid,
	"mother_id" uuid,
	"spouse_of_id" uuid,
	"role" text DEFAULT 'blood' NOT NULL,
	"path" "ltree",
	"depth" integer DEFAULT 0 NOT NULL,
	"generation" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"surname" text NOT NULL,
	"full_name" text NOT NULL,
	"sex" smallint NOT NULL,
	"courtesy" text,
	"name_prefix" text,
	"is_alive" boolean DEFAULT true NOT NULL,
	"birth_text" text,
	"death_text" text,
	"birth_year" integer,
	"death_year" integer,
	"burial_place" text,
	"biography" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_node_organization_id" UNIQUE("organization_id","id"),
	CONSTRAINT "ck_node_role" CHECK ("node"."role" in ('blood', 'spouse')),
	CONSTRAINT "ck_node_sex" CHECK ("node"."sex" in (0, 1)),
	CONSTRAINT "ck_node_spouse_has_no_path" CHECK (("node"."role" = 'spouse' and "node"."path" is null and "node"."spouse_of_id" is not null) or ("node"."role" = 'blood' and "node"."path" is not null))
);
--> statement-breakpoint
CREATE TABLE "organization_member" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_org_member_role" CHECK ("organization_member"."role" in ('owner', 'admin', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"slug" text DEFAULT public.generate_public_id() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ck_organization_status" CHECK ("organization"."status" in ('active', 'suspended', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid NOT NULL,
	"ref" text DEFAULT public.generate_public_id() NOT NULL,
	"name" text NOT NULL,
	"primary_name" text NOT NULL,
	"primary_surname" text NOT NULL,
	"countries_regions" text,
	"hall_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uk_project_organization_id" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"password_hash" text NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article" ADD CONSTRAINT "fk_article_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "book_catalog_book_id_book_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."book"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "book_catalog_parent_id_book_catalog_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."book_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "fk_catalog_article" FOREIGN KEY ("organization_id","article_id") REFERENCES "public"."article"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_catalog" ADD CONSTRAINT "fk_catalog_lineage" FOREIGN KEY ("organization_id","lineage_id") REFERENCES "public"."lineage"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book" ADD CONSTRAINT "fk_book_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folder" ADD CONSTRAINT "fk_folder_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineage" ADD CONSTRAINT "fk_lineage_project" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."project"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_parent_id_node_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."node"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_mother_id_node_id_fk" FOREIGN KEY ("mother_id") REFERENCES "public"."node"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "node_spouse_of_id_node_id_fk" FOREIGN KEY ("spouse_of_id") REFERENCES "public"."node"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node" ADD CONSTRAINT "fk_node_lineage" FOREIGN KEY ("organization_id","lineage_id") REFERENCES "public"."lineage"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_member" ADD CONSTRAINT "organization_member_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project" ADD CONSTRAINT "project_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_activity_logs_org" ON "activity_logs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_activity_logs_user" ON "activity_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_article_project" ON "article" USING btree ("organization_id","project_id") WHERE "article"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_catalog_book" ON "book_catalog" USING btree ("organization_id","book_id","sort") WHERE "book_catalog"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_catalog_article" ON "book_catalog" USING btree ("organization_id","article_id") WHERE "book_catalog"."article_id" is not null;--> statement-breakpoint
CREATE INDEX "idx_catalog_lineage" ON "book_catalog" USING btree ("organization_id","lineage_id") WHERE "book_catalog"."lineage_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_book_name" ON "book" USING btree ("organization_id","project_id","name") WHERE "book"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_folder_project" ON "folder" USING btree ("organization_id","project_id","kind") WHERE "folder"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_invite_token" ON "invite" USING btree ("token_hash") WHERE "invite"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_invite_pending_email" ON "invite" USING btree ("organization_id",lower("email")) WHERE "invite"."email" is not null and "invite"."accepted_at" is null and "invite"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_invite_expiry" ON "invite" USING btree ("expires_at") WHERE "invite"."accepted_at" is null and "invite"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_lineage_name" ON "lineage" USING btree ("organization_id","project_id","name") WHERE "lineage"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_lineage_project" ON "lineage" USING btree ("organization_id","project_id") WHERE "lineage"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_node_lineage_depth" ON "node" USING btree ("organization_id","lineage_id","depth");--> statement-breakpoint
CREATE INDEX "idx_node_parent" ON "node" USING btree ("organization_id","parent_id");--> statement-breakpoint
CREATE INDEX "idx_node_alive" ON "node" USING btree ("organization_id","lineage_id") WHERE "node"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_org_member_active" ON "organization_member" USING btree ("organization_id","user_id") WHERE "organization_member"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_org_member_single_owner" ON "organization_member" USING btree ("organization_id") WHERE "organization_member"."role" = 'owner' and "organization_member"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_org_member_user" ON "organization_member" USING btree ("user_id") WHERE "organization_member"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_organization_slug" ON "organization" USING btree ("slug") WHERE "organization"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_project_ref" ON "project" USING btree ("ref") WHERE "project"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "idx_project_organization" ON "project" USING btree ("organization_id") WHERE "project"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "uk_auth_users_email" ON "auth"."users" USING btree (lower("email")) WHERE "auth"."users"."deleted_at" is null;