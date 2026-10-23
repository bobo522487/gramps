-- The runtime login role is provisioned out of band (local setup / ops). When
-- it exists, make sure it is a member of the RLS-enforcing app_rw role.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT app_rw TO app;
  END IF;
END
$$;
