-- Row level security and the hand-written half of the event fact layer.
--
-- 0020_glorious_tenebrous.sql created `event` from the Drizzle schema. Two
-- things cannot be expressed there and live here instead:
--
--   1. RLS. `event` is ENABLEd *and* FORCEd, because the migration role owns the
--      table and a table that is only ENABLEd silently ignores its policies for
--      the owner. Policies follow the 0001_auth_rls.sql template exactly:
--      `_select` for all four roles, `_insert`/`_update` for owner/admin/editor.
--      app_rw has no DELETE grant anywhere, so removing an event is a soft
--      delete.
--
--   2. The date matrix. Which of `date_start`/`date_end` must be set depends on
--      `date_qualifier`, and a CHECK sees only the row being written, so the
--      combination rule is hand-written here rather than generated.
--
-- The tenant-immutability trigger is the third piece: inside withOrg the app runs
-- as app_rw, which holds UPDATE, and the UPDATE policy's USING half sees the OLD
-- row while WITH CHECK sees only the NEW one; a user who belongs to two
-- organizations therefore satisfies both halves while moving an event into the
-- other tenant. app.forbid_tenant_move() (0015) is the only place that sees OLD
-- and NEW together.

ALTER TABLE event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 0001 granted app_rw SELECT/INSERT/UPDATE on all tables and set DEFAULT
-- PRIVILEGES for tables created later, so this is redundant on a fresh
-- database. It is kept because it is free and it keeps the new table readable in
-- the same place as its policies if the defaults are ever narrowed.
GRANT SELECT, INSERT, UPDATE ON event TO app_rw;
--> statement-breakpoint

CREATE POLICY event_select ON event
  AS PERMISSIVE FOR SELECT TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor', 'viewer']));
--> statement-breakpoint
CREATE POLICY event_insert ON event
  AS PERMISSIVE FOR INSERT TO app_rw
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint
CREATE POLICY event_update ON event
  AS PERMISSIVE FOR UPDATE TO app_rw
  USING (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']))
  WITH CHECK (auth.has_org_role(organization_id, ARRAY['owner', 'admin', 'editor']));
--> statement-breakpoint

-- Both tenant columns are pinned. `person_id`/`family_id` stay writable: moving
-- a fact from a person to that person's union (a 婚配 recorded on the husband
-- first) is a legitimate correction, and the composite
-- (organization_id, project_id, person_id|family_id) keys keep the new subject
-- in the same project.
DROP TRIGGER IF EXISTS trg_event_tenant_immutable ON event;
--> statement-breakpoint
CREATE TRIGGER trg_event_tenant_immutable
  BEFORE UPDATE ON event
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- The date boundary matrix.
--
-- `date_qualifier` is NOT NULL DEFAULT 'unknown' (0020) on purpose. If it were
-- nullable, a row with a NULL qualifier could carry any bounds at all: every
-- constraint below is written as `qualifier <> 'x' OR ...`, and `NULL <> 'x'`
-- is NULL, which a CHECK accepts. The whole matrix would then guard nothing.
--
-- The five constraints are kept separate rather than merged into one, because
-- the qualifiers do not share a shape: `before` and `after` legitimately carry
-- exactly one bound, and a merged constraint would force a fake second bound on
-- them — the placeholder-data defect the v1.0 review criticised.
--
-- Together the five cover all nine DATE_QUALIFIER_VALUES members:
--
--   exact, about, estimated, calculated  -> ck_event_date_point   (both bounds, ordered)
--   before                               -> ck_event_date_before  (end only)
--   after                                -> ck_event_date_after   (start only)
--   between, period                      -> ck_event_date_between (both bounds, ordered)
--   unknown                              -> ck_event_date_unknown (no bounds at all)
--
-- `calculated` belongs to the point set: a computed date is still a closed
-- interval, never a one-sided bound. If a tenth qualifier is ever added to
-- DATE_QUALIFIER_VALUES, it must be added to one of these five constraints in
-- the same migration — a new value is not covered by any of them and would
-- otherwise accept any combination of bounds silently.
--
-- There is deliberately no `ck_event_date_original`: `date_original` is
-- nullable because an event can be known only by its place or only by its
-- description (葬地已知、卒年失考 is the normal case in Chinese genealogy), and
-- `node` carries no burial date at all. A NOT NULL column would force the
-- backfill to fabricate a date string. The "no date" state is
-- `date_qualifier = 'unknown'` with both bounds NULL.
--
-- 0023 later added `ck_event_date_original_not_blank` on top of that: the
-- column is still nullable, but '' and whitespace-only are rejected, so
-- "present but empty" cannot stand in for "no date" either.
-- ---------------------------------------------------------------------------

ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_point;
--> statement-breakpoint
ALTER TABLE event ADD CONSTRAINT ck_event_date_point
  CHECK (date_qualifier NOT IN ('exact', 'about', 'estimated', 'calculated')
         OR (date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end));
--> statement-breakpoint

ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_before;
--> statement-breakpoint
ALTER TABLE event ADD CONSTRAINT ck_event_date_before
  CHECK (date_qualifier <> 'before' OR (date_start IS NULL AND date_end IS NOT NULL));
--> statement-breakpoint

ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_after;
--> statement-breakpoint
ALTER TABLE event ADD CONSTRAINT ck_event_date_after
  CHECK (date_qualifier <> 'after' OR (date_start IS NOT NULL AND date_end IS NULL));
--> statement-breakpoint

ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_between;
--> statement-breakpoint
ALTER TABLE event ADD CONSTRAINT ck_event_date_between
  CHECK (date_qualifier NOT IN ('between', 'period')
         OR (date_start IS NOT NULL AND date_end IS NOT NULL AND date_start <= date_end));
--> statement-breakpoint

ALTER TABLE event DROP CONSTRAINT IF EXISTS ck_event_date_unknown;
--> statement-breakpoint
ALTER TABLE event ADD CONSTRAINT ck_event_date_unknown
  CHECK (date_qualifier <> 'unknown' OR (date_start IS NULL AND date_end IS NULL));
