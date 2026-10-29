-- Row level security and the hand-written half of the person fact layer.
--
-- 0016_grey_electro.sql created `person` and `person_name` from the Drizzle
-- schema, but three things cannot be expressed there and live here instead:
--
--   1. RLS. Every organization-scoped table is ENABLEd *and* FORCEd, because
--      the migration role owns the tables and a table that is only ENABLEd
--      silently ignores its policies for the owner. Policies follow the
--      0001_auth_rls.sql template exactly: `_select` for all four roles,
--      `_insert`/`_update` for owner/admin/editor. app_rw has no DELETE grant
--      anywhere, so the fact layer is soft-delete only.
--
--   2. `fk_person_primary_name`. A person points at one of their own names, and
--      a name points back at its person, so the two tables reference each
--      other. Drizzle cannot emit a cycle inside one generated migration, and
--      the key has to be composite — (organization_id, id, primary_name_id) ->
--      person_name (organization_id, person_id, id) — otherwise
--      `person.primary_name_id` could name another person's name, or a name in
--      another organization. The target unique key
--      uk_person_name_organization_person_id exists from 0016.
--
--   3. The tenant-immutability triggers. Inside withOrg the app runs as app_rw,
--      which holds UPDATE, and the UPDATE policy's USING half sees the OLD row
--      while WITH CHECK sees only the NEW one; a user who belongs to two
--      organizations therefore satisfies both halves while moving a person
--      into the other tenant. app.forbid_tenant_move() (0015) is the only place
--      that sees OLD and NEW together. `legacy_node_id`, `primary_name_id`,
--      `merged_into_id`, `sort_key` and `deleted_at` stay writable: pointing a
--      person at a name, merging a duplicate and soft-deleting are all
--      legitimate updates.

ALTER TABLE person ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE person FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE person_name ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE person_name FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 0001 granted app_rw SELECT/INSERT/UPDATE on all tables and set DEFAULT
-- PRIVILEGES for tables created later, so this is redundant on a fresh
-- database. It is kept because it is free and it keeps the two new tables
-- readable in the same place as their policies if the defaults are ever
-- narrowed.
GRANT SELECT, INSERT, UPDATE ON person, person_name TO app_rw;
--> statement-breakpoint

CREATE POLICY person_select ON person
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY person_insert ON person
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY person_update ON person
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

CREATE POLICY person_name_select ON person_name
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY person_name_insert ON person_name
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY person_name_update ON person_name
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

-- DROP IF EXISTS first: the constraint is not in any Drizzle snapshot, so a
-- re-run of this migration is the only way it would ever already exist.
ALTER TABLE person DROP CONSTRAINT IF EXISTS fk_person_primary_name;
--> statement-breakpoint
ALTER TABLE person ADD CONSTRAINT fk_person_primary_name
  FOREIGN KEY (organization_id, id, primary_name_id)
  REFERENCES person_name (organization_id, person_id, id)
  ON DELETE restrict;
--> statement-breakpoint
-- Child-side index for the composite key above; without it every DELETE or
-- UPDATE of a person_name would scan the whole person table.
CREATE INDEX IF NOT EXISTS idx_person_primary_name
  ON person (organization_id, id, primary_name_id);
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_person_tenant_immutable ON person;
--> statement-breakpoint
CREATE TRIGGER trg_person_tenant_immutable
  BEFORE UPDATE ON person
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- person_id is deliberately not pinned: a name is moved between people by
-- Task 8's reconciliation, and the composite FK keeps it in the same project.
DROP TRIGGER IF EXISTS trg_person_name_tenant_immutable ON person_name;
--> statement-breakpoint
CREATE TRIGGER trg_person_name_tenant_immutable
  BEFORE UPDATE ON person_name
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
