-- Row level security and the hand-written half of the family fact layer.
--
-- 0018_jazzy_unicorn.sql created `family`, `family_partner` and `family_child`
-- from the Drizzle schema. Three things cannot be expressed there and live here
-- instead:
--
--   1. RLS. Every organization-scoped table is ENABLEd *and* FORCEd, because
--      the migration role owns the tables and a table that is only ENABLEd
--      silently ignores its policies for the owner. Policies follow the
--      0001_auth_rls.sql template exactly: `_select` for all four roles,
--      `_insert`/`_update` for owner/admin/editor. app_rw has no DELETE grant
--      anywhere, so dissolving a union or removing a child is a soft delete.
--
--   2. `app.check_family_blood_side()`. "At most one blood partner per family"
--      is a cross-row rule, so it cannot be a CHECK: a CHECK sees only the row
--      being written. It is a trigger, and it has to take a transaction-scoped
--      advisory lock on the family before counting, or two concurrent inserts
--      both see zero blood partners and both succeed.
--
--   3. The tenant-immutability triggers. Inside withOrg the app runs as app_rw,
--      which holds UPDATE, and the UPDATE policy's USING half sees the OLD row
--      while WITH CHECK sees only the NEW one; a user who belongs to two
--      organizations therefore satisfies both halves while moving a family into
--      the other tenant. app.forbid_tenant_move() (0015) is the only place that
--      sees OLD and NEW together.

ALTER TABLE family ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE family FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE family_partner ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE family_partner FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE family_child ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE family_child FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 0001 granted app_rw SELECT/INSERT/UPDATE on all tables and set DEFAULT
-- PRIVILEGES for tables created later, so this is redundant on a fresh
-- database. It is kept because it is free and it keeps the three new tables
-- readable in the same place as their policies if the defaults are ever
-- narrowed.
GRANT SELECT, INSERT, UPDATE ON family, family_partner, family_child TO app_rw;
--> statement-breakpoint

CREATE POLICY family_select ON family
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY family_insert ON family
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY family_update ON family
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

CREATE POLICY family_partner_select ON family_partner
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY family_partner_insert ON family_partner
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY family_partner_update ON family_partner
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

CREATE POLICY family_child_select ON family_child
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY family_child_insert ON family_child
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY family_child_update ON family_child
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

-- The blood-side invariant: a union has at most one 血亲 side (the rest are
-- 姻亲, role = 'spouse'), unless the project has opted into 族内婚.
--
-- Why only the upper bound, and why that is not an oversight: the blueprint
-- (§9.3) also says every family has *at least* one blood partner, but "at
-- least one" cannot be checked here. Inserting the spouse row before the blood
-- row is a legal intermediate state — a user creating a 婚配 may know the
-- wife's name and not yet the husband's — and only an UPDATE or the end of the
-- transaction would make the lower bound true. P1 therefore enforces the upper
-- bound only; the lower bound belongs to the Task 7 backfill and to the future
-- `validation_issue` checker (P9), which reports it instead of blocking writes.
--
-- Three details are load-bearing:
--   * the predicate is `blood_count >= 1`, not `> 1`. On INSERT the new row is
--     not in the table yet, so the count is of the *other* blood partners;
--     `id <> NEW.id` only excludes this row's own previous version on UPDATE.
--     With `> 1` the second blood partner would pass.
--   * when the project allows consanguineous marriage the function returns
--     before the lock, so permitted multi-blood families never serialise.
--   * soft-deleted blood partners do not count: dissolving a union sets
--     `deleted_at`, it does not delete the row.
CREATE OR REPLACE FUNCTION app.check_family_blood_side() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  blood_count integer;
  allow_consanguineous boolean;
BEGIN
  IF NEW.role <> 'blood' OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.allow_consanguineous_marriage INTO allow_consanguineous
  FROM public.project p
  WHERE p.id = NEW.project_id;

  IF allow_consanguineous THEN
    RETURN NEW;   -- 谱系级放开了族内婚（堂兄妹婚），允许多个血亲侧
  END IF;

  -- 同一 family 的并发写入必须串行，否则两个事务各插一个 blood partner 都能通过
  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.organization_id::text || ':' || NEW.family_id::text, 0));

  SELECT count(*) INTO blood_count
  FROM public.family_partner
  WHERE organization_id = NEW.organization_id
    AND family_id = NEW.family_id
    AND role = 'blood'
    AND deleted_at IS NULL
    AND id <> NEW.id;

  IF blood_count >= 1 THEN
    RAISE EXCEPTION 'family % already has a blood partner', NEW.family_id
      USING ERRCODE = '23514',
            HINT = 'set project.allow_consanguineous_marriage to allow consanguineous unions';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_family_partner_blood_side ON family_partner;
--> statement-breakpoint
CREATE TRIGGER trg_family_partner_blood_side
  BEFORE INSERT OR UPDATE ON family_partner
  FOR EACH ROW EXECUTE FUNCTION app.check_family_blood_side();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_family_tenant_immutable ON family;
--> statement-breakpoint
CREATE TRIGGER trg_family_tenant_immutable
  BEFORE UPDATE ON family
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- family_id is writable on both child tables: moving a partner or a child to
-- another union in the same project is a legitimate correction, and the
-- composite (organization_id, project_id, family_id) foreign key keeps it in
-- the same project.
DROP TRIGGER IF EXISTS trg_family_partner_tenant_immutable ON family_partner;
--> statement-breakpoint
CREATE TRIGGER trg_family_partner_tenant_immutable
  BEFORE UPDATE ON family_partner
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_family_child_tenant_immutable ON family_child;
--> statement-breakpoint
CREATE TRIGGER trg_family_child_tenant_immutable
  BEFORE UPDATE ON family_child
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
