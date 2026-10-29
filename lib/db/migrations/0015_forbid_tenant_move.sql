-- Tenant and ownership columns must never be reassigned by an UPDATE.
--
-- Inside withOrg the app runs as app_rw, which holds UPDATE on every business
-- table, and the RLS UPDATE policy is split in two halves: USING sees the OLD
-- row, WITH CHECK sees only the NEW one. A user who belongs to two
-- organizations therefore satisfies both halves while moving a row from one
-- tenant into the other — `update project set organization_id = <other org>`
-- returned without an error before this migration, and the same held for
-- lineage, node, folder and the rest. That is blueprint §7.5 and the P0 item
-- of the 2026-10-29 data-model review: a real privilege-escalation path in
-- shipped code, not a hypothetical one.
--
-- The fix is a BEFORE UPDATE row trigger, not a tighter policy. A policy can
-- only look at OLD (USING) or NEW (WITH CHECK) in isolation, so no combination
-- of USING/WITH CHECK can compare the two rows; a trigger is the only place in
-- PostgreSQL that sees both halves at once. Doing it here also keeps the rule
-- out of 12 hand-written policy blocks and out of every query in lib/.
--
-- One function serves all tables: the columns to pin are passed as TG_ARGV, so
-- adding a table later is one CREATE TRIGGER, not another 20 lines of
-- PL/pgSQL. Because every argument list is hand-written, the function also
-- rejects an argument that is not a column on the row (42703): a typo would
-- make to_jsonb(NEW) -> 'typo' NULL on both sides and silently protect
-- nothing. Column lists are deliberately ownership-only: parent_id,
-- spouse_of_id, sort, path, deleted_at and the rest stay writable, because
-- moving a node under a new parent and soft-deleting a row are legitimate
-- operations (tests/integration/nodes.test.ts covers both).
--
-- Every new organization-scoped table must add its own
-- trg_<table>_tenant_immutable trigger here; tests/integration/
-- tenant-immutability.test.ts asserts the exact set of guarded tables, so a
-- new table without a trigger turns that test red.
CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint

-- Compares each column named in TG_ARGV between OLD and NEW. IS DISTINCT FROM
-- rather than <>: tenant columns are nullable (activity_logs.organization_id is
-- NULL for account-level events), and NULL <> NULL is NULL, which would let a
-- NULL -> value move through.
CREATE OR REPLACE FUNCTION app.forbid_tenant_move() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    -- Guard the hand-written argument list: to_jsonb(NEW) -> 'organisation_id'
    -- is NULL on both sides, so the comparison below would pass every time and
    -- the table would be silently unprotected. 42703 (undefined_column) turns
    -- that typo into an error the first time the trigger fires.
    IF NOT (to_jsonb(NEW) ? col) THEN
      RAISE EXCEPTION 'tenant column % does not exist on %', col, TG_TABLE_NAME
        USING ERRCODE = '42703';
    END IF;

    IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
      RAISE EXCEPTION 'column %.% is immutable', TG_TABLE_NAME, col
        USING ERRCODE = '42501',
              HINT = 'tenant and ownership columns cannot be reassigned; create a new row instead';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA app TO app_rw;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.forbid_tenant_move() TO app_rw;
--> statement-breakpoint
-- Both runtime roles get EXECUTE, not just app_rw. organization,
-- organization_member and invite are written by the auth_service connection
-- (Better Auth's organization plugin UPDATEs them to change a member's role or
-- an organization's name), so auth_service must be able to resolve and run the
-- function wherever a deployment creates these triggers with a less privileged
-- migration role than the local superuser.
--
-- Measured on PostgreSQL 18.6, in a scratch schema, inside a transaction that
-- was rolled back: with `REVOKE ALL ON FUNCTION ... FROM PUBLIC` in place
-- (has_function_privilege('app_rw', ..., 'EXECUTE') = false) an UPDATE still
-- fired the trigger and raised the function's own exception, so EXECUTE is NOT
-- checked when a trigger fires; the same function under CREATE TRIGGER as
-- app_rw failed with 42501 "permission denied for function". The check happens
-- when the trigger is created, not when it runs.
--
-- A function is EXECUTE-able by PUBLIC by default (proacl shows `=X/<owner>`),
-- which is why revoking the grant from auth_service alone would change nothing.
-- While PUBLIC keeps its default the explicit grants are redundant; they are
-- kept because they are free, they survive a future REVOKE FROM PUBLIC, and
-- they satisfy the CREATE TRIGGER check when the migrating role does not own
-- the function.
--
-- Deliberately no `REVOKE ALL ... FROM PUBLIC`: the function only reads NEW and
-- OLD and may RAISE, so there is nothing to abuse (ADR 0016, 后果).
GRANT USAGE ON SCHEMA app TO auth_service;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.forbid_tenant_move() TO auth_service;
--> statement-breakpoint

-- organization_member: membership is scoped by organization alone.
DROP TRIGGER IF EXISTS trg_organization_member_tenant_immutable ON organization_member;
--> statement-breakpoint
CREATE TRIGGER trg_organization_member_tenant_immutable
  BEFORE UPDATE ON organization_member
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id');
--> statement-breakpoint

-- invite: an invitation belongs to the organization that issued it.
DROP TRIGGER IF EXISTS trg_invite_tenant_immutable ON invite;
--> statement-breakpoint
CREATE TRIGGER trg_invite_tenant_immutable
  BEFORE UPDATE ON invite
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id');
--> statement-breakpoint

-- project: organization_id is the tenant key.
DROP TRIGGER IF EXISTS trg_project_tenant_immutable ON project;
--> statement-breakpoint
CREATE TRIGGER trg_project_tenant_immutable
  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id');
--> statement-breakpoint

-- folder: parent_id stays writable (folders move); organization/project do not.
DROP TRIGGER IF EXISTS trg_folder_tenant_immutable ON folder;
--> statement-breakpoint
CREATE TRIGGER trg_folder_tenant_immutable
  BEFORE UPDATE ON folder
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- lineage: organization_id + project_id are the tenant keys; folder_id is a
-- container that legitimately changes when content is refiled or a folder is
-- deleted (deleteFolderInTransaction NULLs it at
-- lib/folder/services.ts:268-309), so it is not pinned.
DROP TRIGGER IF EXISTS trg_lineage_tenant_immutable ON lineage;
--> statement-breakpoint
CREATE TRIGGER trg_lineage_tenant_immutable
  BEFORE UPDATE ON lineage
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- node: a person belongs to exactly one lineage; parent_id/path move freely.
DROP TRIGGER IF EXISTS trg_node_tenant_immutable ON node;
--> statement-breakpoint
CREATE TRIGGER trg_node_tenant_immutable
  BEFORE UPDATE ON node
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'lineage_id');
--> statement-breakpoint

-- article / book: same shape as lineage — folder_id is refiling, not a move
-- between tenants.
DROP TRIGGER IF EXISTS trg_article_tenant_immutable ON article;
--> statement-breakpoint
CREATE TRIGGER trg_article_tenant_immutable
  BEFORE UPDATE ON article
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_book_tenant_immutable ON book;
--> statement-breakpoint
CREATE TRIGGER trg_book_tenant_immutable
  BEFORE UPDATE ON book
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'project_id');
--> statement-breakpoint

-- book_catalog: book_id is the tenant key (a catalog row belongs to one book).
DROP TRIGGER IF EXISTS trg_book_catalog_tenant_immutable ON book_catalog;
--> statement-breakpoint
CREATE TRIGGER trg_book_catalog_tenant_immutable
  BEFORE UPDATE ON book_catalog
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id', 'book_id');
--> statement-breakpoint

-- activity_logs: organization_id is nullable for account-level events, and the
-- trigger pins it either way (NULL -> org is still a tenant move).
DROP TRIGGER IF EXISTS trg_activity_logs_tenant_immutable ON activity_logs;
--> statement-breakpoint
CREATE TRIGGER trg_activity_logs_tenant_immutable
  BEFORE UPDATE ON activity_logs
  FOR EACH ROW EXECUTE FUNCTION app.forbid_tenant_move('organization_id');
