-- The body below holds semicolons that do not end a statement.
CREATE FUNCTION public.bound_organisation() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('portal.organisation_id', true), '');
  SELECT 1;
$$;
