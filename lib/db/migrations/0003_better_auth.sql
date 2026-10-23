-- Self-hosted Better Auth: new auth tables, tenant-safe roles, and the
-- auth_service runtime that owns identity and membership writes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.organization LIMIT 1) THEN
    RAISE EXCEPTION
      '0003_better_auth requires an empty auth/tenant dataset; recreate the dev/staging database';
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_service') THEN
    EXECUTE 'CREATE ROLE auth_service NOLOGIN NOSUPERUSER NOBYPASSRLS';
  END IF;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    EXECUTE 'GRANT app_rw TO app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auth_runtime') THEN
    EXECUTE 'GRANT auth_service TO auth_runtime';
  END IF;
END $$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
--> statement-breakpoint

DROP POLICY IF EXISTS organization_select ON organization;
--> statement-breakpoint
DROP POLICY IF EXISTS organization_update ON organization;
--> statement-breakpoint
DROP POLICY IF EXISTS organization_member_select ON organization_member;
--> statement-breakpoint
DROP POLICY IF EXISTS organization_member_insert ON organization_member;
--> statement-breakpoint
DROP POLICY IF EXISTS organization_member_update ON organization_member;
--> statement-breakpoint
DROP POLICY IF EXISTS invite_select ON invite;
--> statement-breakpoint
DROP POLICY IF EXISTS invite_insert ON invite;
--> statement-breakpoint
DROP POLICY IF EXISTS invite_update ON invite;
--> statement-breakpoint

DROP FUNCTION IF EXISTS auth.sign_up(text, text, text, text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.find_user_by_email(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.get_session_user();
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.update_password(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.update_profile(text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.soft_delete_user();
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.accept_invite(text, text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.create_organization(text);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.list_org_members(uuid);
--> statement-breakpoint
DROP FUNCTION IF EXISTS auth.is_user_in_org_by_email(text, uuid);
--> statement-breakpoint

-- Replace before the column drop so no policy depends on the removed column.
CREATE OR REPLACE FUNCTION auth.has_org_role(p_org_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_member m
    WHERE m.organization_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.role = ANY(p_roles)
  )
$$;
--> statement-breakpoint
ALTER FUNCTION auth.has_org_role(uuid, text[]) OWNER TO auth_service;
--> statement-breakpoint

DROP INDEX IF EXISTS auth.uk_auth_users_email;
--> statement-breakpoint
ALTER TABLE auth.users DROP COLUMN "password_hash";
--> statement-breakpoint
ALTER TABLE auth.users DROP COLUMN "token_version";
--> statement-breakpoint
ALTER TABLE auth.users DROP COLUMN "deleted_at";
--> statement-breakpoint
ALTER TABLE auth.users ALTER COLUMN "name" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.users ALTER COLUMN "updated_at" SET DEFAULT now();
--> statement-breakpoint
ALTER TABLE auth.users ALTER COLUMN "updated_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.users ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE auth.users ADD COLUMN "image" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_auth_users_email" ON "auth"."users" USING btree (lower("email"));
--> statement-breakpoint
CREATE INDEX "idx_auth_users_email" ON "auth"."users" USING btree ("email");
--> statement-breakpoint

ALTER TABLE "organization" ADD COLUMN "logo" text;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "metadata" text;
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint

DROP INDEX IF EXISTS "public"."uk_org_member_active";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."uk_org_member_single_owner";
--> statement-breakpoint
ALTER TABLE "organization_member" DROP COLUMN "created_by";
--> statement-breakpoint
ALTER TABLE "organization_member" DROP COLUMN "deleted_at";
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_org_member_organization_user" ON "organization_member" USING btree ("organization_id","user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_org_member_single_owner" ON "organization_member" USING btree ("organization_id") WHERE "organization_member"."role" = 'owner';
--> statement-breakpoint

DROP INDEX IF EXISTS "public"."uk_invite_token";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."uk_invite_pending_email";
--> statement-breakpoint
DROP INDEX IF EXISTS "public"."idx_invite_expiry";
--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "token_hash";
--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "accepted_at";
--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "accepted_by";
--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "created_by";
--> statement-breakpoint
ALTER TABLE "invite" DROP COLUMN "deleted_at";
--> statement-breakpoint
ALTER TABLE "invite" ALTER COLUMN "email" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE "invite" ADD COLUMN "inviter_id" uuid NOT NULL;
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "ck_invite_status" CHECK ("invite"."status" in ('pending', 'accepted', 'rejected', 'canceled'));
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_invite_pending_email" ON "invite" USING btree ("organization_id",lower("email")) WHERE "invite"."status" = 'pending';
--> statement-breakpoint
CREATE INDEX "idx_invite_expiry" ON "invite" USING btree ("expires_at") WHERE "invite"."status" = 'pending';
--> statement-breakpoint

CREATE TABLE "auth"."session" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" uuid
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_auth_session_token" ON "auth"."session" USING btree ("token");
--> statement-breakpoint
CREATE INDEX "idx_auth_session_user" ON "auth"."session" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "auth"."session" ADD CONSTRAINT "session_active_organization_id_organization_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "auth"."account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uk_auth_account_provider_account" ON "auth"."account" USING btree ("provider_id","account_id");
--> statement-breakpoint
CREATE INDEX "idx_auth_account_user" ON "auth"."account" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "auth"."account" ADD CONSTRAINT "account_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

CREATE TABLE "auth"."verification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_auth_verification_identifier" ON "auth"."verification" USING btree ("identifier");
--> statement-breakpoint
CREATE INDEX "idx_auth_verification_expires" ON "auth"."verification" USING btree ("expires_at");
--> statement-breakpoint

REVOKE ALL ON ALL TABLES IN SCHEMA auth FROM app_rw;
--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA auth FROM app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA auth REVOKE EXECUTE ON FUNCTIONS FROM app_rw;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON organization FROM app_rw;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON organization_member FROM app_rw;
--> statement-breakpoint
REVOKE SELECT, INSERT, UPDATE, DELETE ON invite FROM app_rw;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO auth_service;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO auth_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users, auth.session, auth.account, auth.verification TO auth_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON organization TO auth_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_member TO auth_service;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON invite TO auth_service;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.generate_public_id() TO auth_service;
--> statement-breakpoint

ALTER TABLE auth.session ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.account ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.account FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.verification ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.verification FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY auth_users_service ON auth.users
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_session_service ON auth.session
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_account_service ON auth.account
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_verification_service ON auth.verification
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY organization_select ON organization
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (
    deleted_at IS NULL
    AND auth.has_org_role(id, ARRAY['owner', 'admin', 'editor', 'viewer'])
  );
--> statement-breakpoint
CREATE POLICY organization_service ON organization
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY organization_member_select ON organization_member
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY organization_member_service ON organization_member
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE POLICY invite_service ON invite
  AS PERMISSIVE FOR ALL TO auth_service
  USING (true) WITH CHECK (true);
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_local_part text;
BEGIN
  v_local_part := nullif(split_part(coalesce(new.email, ''), '@', 1), '');

  INSERT INTO organization (name)
  VALUES (coalesce(nullif(new.name, ''), v_local_part, '我的家族'))
  RETURNING id INTO v_org_id;

  INSERT INTO organization_member (organization_id, user_id, role)
  VALUES (v_org_id, new.id, 'owner');

  RETURN new;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.handle_new_user() OWNER TO auth_service;
--> statement-breakpoint
CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enforce_last_owner_delete()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_archived boolean;
BEGIN
  IF OLD.role <> 'owner' THEN
    RETURN OLD;
  END IF;

  SELECT deleted_at IS NOT NULL INTO v_archived
  FROM organization
  WHERE id = OLD.organization_id;

  IF coalesce(v_archived, false) THEN
    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organization_member
    WHERE organization_id = OLD.organization_id
      AND role = 'owner'
      AND id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'last_owner';
  END IF;

  RETURN OLD;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.enforce_last_owner_delete() OWNER TO auth_service;
--> statement-breakpoint
CREATE TRIGGER trg_org_member_last_owner_delete
  BEFORE DELETE ON organization_member
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_owner_delete();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enforce_last_owner_update()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_archived boolean;
BEGIN
  IF OLD.role <> 'owner'
     OR (
       NEW.role = 'owner'
       AND NEW.organization_id = OLD.organization_id
     ) THEN
    RETURN NEW;
  END IF;

  SELECT deleted_at IS NOT NULL INTO v_archived
  FROM organization
  WHERE id = OLD.organization_id;

  IF coalesce(v_archived, false) THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organization_member
    WHERE organization_id = OLD.organization_id
      AND role = 'owner'
      AND id <> OLD.id
  ) THEN
    RAISE EXCEPTION 'last_owner';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.enforce_last_owner_update() OWNER TO auth_service;
--> statement-breakpoint
CREATE TRIGGER trg_org_member_last_owner_update
  BEFORE UPDATE OF role, organization_id ON organization_member
  FOR EACH ROW EXECUTE FUNCTION public.enforce_last_owner_update();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enforce_active_org()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM organization
    WHERE id = NEW.organization_id
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'org_archived';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.enforce_active_org() OWNER TO auth_service;
--> statement-breakpoint
CREATE TRIGGER trg_org_member_active_org
  BEFORE INSERT ON organization_member
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_org();
--> statement-breakpoint
CREATE TRIGGER trg_invite_active_org
  BEFORE INSERT ON invite
  FOR EACH ROW EXECUTE FUNCTION public.enforce_active_org();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.enforce_org_slug_immutable()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'slug_immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION public.enforce_org_slug_immutable() OWNER TO auth_service;
--> statement-breakpoint
CREATE TRIGGER trg_org_slug_immutable
  BEFORE UPDATE OF slug ON organization
  FOR EACH ROW EXECUTE FUNCTION public.enforce_org_slug_immutable();
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.archive_organization(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM organization o
    JOIN organization_member m ON m.organization_id = o.id
    WHERE o.id = p_org_id
      AND o.deleted_at IS NULL
      AND m.user_id = auth.uid()
      AND m.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE organization
  SET status = 'closed',
      deleted_at = now(),
      updated_at = now()
  WHERE id = p_org_id
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
END;
$$;
--> statement-breakpoint
ALTER FUNCTION auth.archive_organization(uuid) OWNER TO auth_service;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION auth.archive_organization(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.archive_organization(uuid) TO app_rw, auth_service;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.uid() TO app_rw, auth_service;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION auth.has_org_role(uuid, text[]) TO app_rw, auth_service;
