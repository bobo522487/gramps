-- Runtime role. Migrations run as the owner/superuser; the app switches into
-- app_rw inside each transaction so RLS is actually enforced.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN
    EXECUTE 'CREATE ROLE app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS';
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid
$$;
--> statement-breakpoint

-- SECURITY DEFINER so organization_member policies can check the actor's role
-- without recursing into their own policy.
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
      AND m.deleted_at IS NULL
      AND m.role = ANY(p_roles)
  )
$$;
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
  VALUES (coalesce(v_local_part, '我的家族'))
  RETURNING id INTO v_org_id;

  INSERT INTO organization_member (organization_id, user_id, role, created_by)
  VALUES (v_org_id, new.id, 'owner', new.id);

  RETURN new;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
--> statement-breakpoint

-- Registration is one SQL function call, so a bad invite rolls back the user
-- row as well: no orphan accounts. The trigger creates the default org.
CREATE OR REPLACE FUNCTION auth.sign_up(
  p_email text,
  p_name text,
  p_password_hash text,
  p_invite_token_hash text DEFAULT NULL,
  p_ip text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  token_version integer,
  default_organization_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user auth.users;
  v_invite invite;
  v_org_id uuid;
  v_invited_org_id uuid;
BEGIN
  INSERT INTO auth.users (email, name, password_hash)
  VALUES (lower(p_email), nullif(p_name, ''), p_password_hash)
  RETURNING * INTO v_user;

  SELECT m.organization_id INTO v_org_id
  FROM organization_member m
  WHERE m.user_id = v_user.id
    AND m.role = 'owner'
    AND m.deleted_at IS NULL
  LIMIT 1;

  IF p_invite_token_hash IS NOT NULL THEN
    SELECT i.* INTO v_invite
    FROM invite i
    WHERE i.token_hash = p_invite_token_hash
      AND i.accepted_at IS NULL
      AND i.deleted_at IS NULL
      AND i.expires_at > now()
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_invitation';
    END IF;

    IF v_invite.email IS NOT NULL
       AND lower(v_invite.email) <> lower(p_email) THEN
      RAISE EXCEPTION 'invalid_invitation';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM organization o
      WHERE o.id = v_invite.organization_id AND o.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'invalid_invitation';
    END IF;

    INSERT INTO organization_member (organization_id, user_id, role, created_by)
    VALUES (v_invite.organization_id, v_user.id, v_invite.role, v_invite.created_by);

    UPDATE invite
    SET accepted_at = now(), accepted_by = v_user.id
    WHERE invite.id = v_invite.id;

    v_invited_org_id := v_invite.organization_id;
  END IF;

  INSERT INTO activity_logs (organization_id, user_id, action, ip_address)
  VALUES (NULL, v_user.id, 'SIGN_UP', nullif(p_ip, ''));

  IF v_invited_org_id IS NOT NULL THEN
    INSERT INTO activity_logs (organization_id, user_id, action, ip_address)
    VALUES (v_invited_org_id, v_user.id, 'ACCEPT_INVITATION', nullif(p_ip, ''));
  ELSE
    INSERT INTO activity_logs (organization_id, user_id, action, ip_address)
    VALUES (v_org_id, v_user.id, 'CREATE_ORG', nullif(p_ip, ''));
  END IF;

  RETURN QUERY
    SELECT v_user.id, v_user.email, v_user.name, v_user.token_version, v_org_id;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.find_user_by_email(p_email text)
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  token_version integer,
  deleted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT u.id, u.email, u.name, u.password_hash, u.token_version, u.deleted_at
  FROM auth.users u
  WHERE lower(u.email) = lower(p_email)
  LIMIT 1
$$;
--> statement-breakpoint

-- Self-scoped: the caller id comes from verified JWT claims, never from an
-- argument, so app_rw cannot read arbitrary accounts through this function.
CREATE OR REPLACE FUNCTION auth.get_session_user()
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  password_hash text,
  token_version integer,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  SELECT u.id, u.email, u.name, u.password_hash, u.token_version,
         u.created_at, u.updated_at, u.deleted_at
  FROM auth.users u
  WHERE u.id = auth.uid()
  LIMIT 1
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.update_password(p_password_hash text)
RETURNS integer
LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  UPDATE auth.users
  SET password_hash = p_password_hash,
      token_version = token_version + 1,
      updated_at = now()
  WHERE id = auth.uid() AND deleted_at IS NULL
  RETURNING token_version
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.update_profile(
  p_name text,
  p_email text
)
RETURNS TABLE (id uuid, email text, name text)
LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  UPDATE auth.users
  SET name = p_name,
      email = lower(p_email),
      updated_at = now()
  WHERE id = auth.uid() AND deleted_at IS NULL
  RETURNING id, email, name
$$;
--> statement-breakpoint

-- Revokes sessions and every membership. The app checks sole ownership in
-- the same transaction; app_rw has no DELETE grant on business tables.
CREATE OR REPLACE FUNCTION auth.soft_delete_user()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
  UPDATE organization_member
  SET deleted_at = now()
  WHERE user_id = auth.uid() AND deleted_at IS NULL;

  UPDATE invite
  SET deleted_at = now()
  WHERE created_by = auth.uid()
    AND accepted_at IS NULL
    AND deleted_at IS NULL;

  UPDATE auth.users
  SET deleted_at = now(),
      email = left(email, 180) || '-' || id::text || '-deleted',
      token_version = token_version + 1,
      updated_at = now()
  WHERE id = auth.uid() AND deleted_at IS NULL;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.accept_invite(
  p_token_hash text,
  p_ip text DEFAULT NULL
)
RETURNS TABLE (organization_id uuid, role text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user auth.users;
  v_invite invite;
BEGIN
  SELECT u.* INTO v_user
  FROM auth.users u
  WHERE u.id = auth.uid() AND u.deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT i.* INTO v_invite
  FROM invite i
  WHERE i.token_hash = p_token_hash
    AND i.accepted_at IS NULL
    AND i.deleted_at IS NULL
    AND i.expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  IF v_invite.email IS NOT NULL
     AND lower(v_invite.email) <> lower(v_user.email) THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organization o
    WHERE o.id = v_invite.organization_id AND o.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_invitation';
  END IF;

  INSERT INTO organization_member (organization_id, user_id, role, created_by)
  VALUES (v_invite.organization_id, v_user.id, v_invite.role, v_invite.created_by)
  ON CONFLICT DO NOTHING;

  UPDATE invite
  SET accepted_at = now(), accepted_by = v_user.id
  WHERE invite.id = v_invite.id;

  INSERT INTO activity_logs (organization_id, user_id, action, ip_address)
  VALUES (v_invite.organization_id, v_user.id, 'ACCEPT_INVITATION', nullif(p_ip, ''));

  RETURN QUERY SELECT v_invite.organization_id, v_invite.role;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.create_organization(p_name text)
RETURNS TABLE (id uuid, slug text, name text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_org organization;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO organization (name)
  VALUES (p_name)
  RETURNING * INTO v_org;

  INSERT INTO organization_member (organization_id, user_id, role, created_by)
  VALUES (v_org.id, v_user_id, 'owner', v_user_id);

  RETURN QUERY SELECT v_org.id, v_org.slug, v_org.name;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.list_org_members(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  role text,
  created_at timestamptz,
  name text,
  email text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_member m
    WHERE m.organization_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT m.id, m.user_id, m.role, m.created_at, u.name, u.email
    FROM organization_member m
    JOIN auth.users u ON u.id = m.user_id
    WHERE m.organization_id = p_org_id
      AND m.deleted_at IS NULL
      AND u.deleted_at IS NULL
    ORDER BY m.created_at;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION auth.is_user_in_org_by_email(
  p_email text,
  p_org_id uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM organization_member m
    WHERE m.organization_id = p_org_id
      AND m.user_id = auth.uid()
      AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.users u
    JOIN organization_member m ON m.user_id = u.id
    WHERE lower(u.email) = lower(p_email)
      AND u.deleted_at IS NULL
      AND m.organization_id = p_org_id
      AND m.deleted_at IS NULL
  );
END;
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO app_rw;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth TO app_rw;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO app_rw;
--> statement-breakpoint
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO app_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.generate_public_id() TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO app_rw;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT EXECUTE ON FUNCTIONS TO app_rw;
--> statement-breakpoint

ALTER TABLE organization ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_select ON organization
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (
    id IN (
      SELECT m.organization_id FROM organization_member m
      WHERE m.user_id = auth.uid() AND m.deleted_at IS NULL
    )
  );
--> statement-breakpoint
CREATE POLICY organization_update ON organization
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(id, ARRAY['owner']))
  WITH CHECK (auth.has_org_role(id, ARRAY['owner']));
--> statement-breakpoint

ALTER TABLE organization_member ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE organization_member FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY organization_member_select ON organization_member
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY organization_member_insert ON organization_member
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY organization_member_update ON organization_member
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

ALTER TABLE invite ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE invite FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY invite_select ON invite
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY invite_insert ON invite
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY invite_update ON invite
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

ALTER TABLE project ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY project_select ON project
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY project_insert ON project
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint
CREATE POLICY project_update ON project
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin']));
--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['folder', 'lineage', 'node', 'article', 'book', 'book_catalog']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        AS PERMISSIVE FOR SELECT TO app_rw
        USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']))
    $f$, t || '_select', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        AS PERMISSIVE FOR INSERT TO app_rw
        WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
    $f$, t || '_insert', t);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
        AS PERMISSIVE FOR UPDATE TO app_rw
        USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
        WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
    $f$, t || '_update', t);
  END LOOP;
END
$$;
--> statement-breakpoint

ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE activity_logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY activity_logs_select ON activity_logs
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer'])
    )
  );
--> statement-breakpoint
CREATE POLICY activity_logs_insert ON activity_logs
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (
    user_id = auth.uid()
    AND (
      organization_id IS NULL
      OR auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer'])
    )
  );
--> statement-breakpoint

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.users FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE INDEX idx_node_lineage_path ON node
  USING gist (organization_id, lineage_id, path);
--> statement-breakpoint
CREATE INDEX idx_node_search ON node
  USING gin (full_name gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX idx_article_search ON article
  USING gin (plain_text gin_trgm_ops);
