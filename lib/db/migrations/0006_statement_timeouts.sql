-- Query guardrails for the runtime roles.
--
-- Without these, one degenerate query (for example a subtree rewrite over a
-- lineage that grew far beyond expectations) can occupy every pooled connection
-- until the platform timeout kills the function, taking the whole instance
-- down. The pool is small (max 5), there is no DBA, so the database itself has
-- to bound the blast radius.
--
-- app_rw is created by 0001 and auth_service by 0003, so both exist here.

ALTER ROLE app_rw SET statement_timeout = '10s';
--> statement-breakpoint
ALTER ROLE app_rw SET idle_in_transaction_session_timeout = '30s';
--> statement-breakpoint
ALTER ROLE app_rw SET lock_timeout = '5s';
--> statement-breakpoint
ALTER ROLE auth_service SET statement_timeout = '10s';
--> statement-breakpoint
ALTER ROLE auth_service SET idle_in_transaction_session_timeout = '30s';
