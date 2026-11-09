-- WhatsApp links for pending personal-room reservation requests.
-- Execute after phase2m.sql in Supabase SQL Editor.

DROP FUNCTION IF EXISTS send_whatsapp_notification(bigint, text, text, text, text, text);

CREATE OR REPLACE FUNCTION get_reservation_whatsapp_targets(p_reservation_id bigint)
RETURNS TABLE (name text, phone text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_allowed() THEN
    RAISE EXCEPTION 'Somente usuarios autorizados podem consultar telefones.';
  END IF;

  RETURN QUERY
  SELECT coalesce(nullif(btrim(u.name), ''), 'Responsável'), u.phone
  FROM reservations r
  JOIN spaces s ON s.id = r.space_id
  JOIN allowed_users u ON u.family_id = s.family_id
  WHERE r.id = p_reservation_id
    AND r.status = 'pending'
    AND r.kind = 'stay'
    AND s.kind = 'personal'
    AND lower(r.created_by) = me_email()
    AND NOT is_admin()
    AND NOT EXISTS (
      SELECT 1
      FROM allowed_users requester
      WHERE requester.email = me_email()
        AND requester.family_id = s.family_id
    )
    AND u.is_responsible
    AND nullif(btrim(u.phone), '') IS NOT NULL
  ORDER BY u.name, u.email;
END;
$$;

REVOKE ALL ON FUNCTION get_reservation_whatsapp_targets(bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_reservation_whatsapp_targets(bigint) TO authenticated;
