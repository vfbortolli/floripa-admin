-- WhatsApp reminders for unpaid monthly memberships.
-- Execute after phase2o.sql and before publishing the billing reminder feature.

CREATE OR REPLACE FUNCTION get_membership_whatsapp_targets()
RETURNS TABLE (family_id int, name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Somente administradores podem consultar telefones para cobrança.';
  END IF;

  RETURN QUERY
  SELECT u.family_id, coalesce(nullif(btrim(u.name), ''), u.email), u.phone
  FROM allowed_users u
  WHERE u.is_responsible
    AND u.family_id IS NOT NULL
  ORDER BY u.family_id, u.name, u.email;
END;
$$;

REVOKE ALL ON FUNCTION get_membership_whatsapp_targets() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_membership_whatsapp_targets() TO authenticated;
