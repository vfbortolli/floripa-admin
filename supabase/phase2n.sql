-- Create RPC function to send WhatsApp notification for pending reservations
-- This function sends a message to the person responsible for approving the reservation

CREATE OR REPLACE FUNCTION send_whatsapp_notification(
  p_reservation_id bigint,
  p_recipient_phone text,
  p_guest_names text,
  p_space_name text,
  p_check_in text,
  p_check_out text
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_message text;
  v_whatsapp_api_url text := 'https://graph.instagram.com/v18.0/YOUR_PHONE_NUMBER_ID/messages';
  v_notification_id bigint;
BEGIN
  -- Build the message
  v_message := 'Nova solicitação de reserva para ' || p_space_name || E'\n' ||
               'Hóspedes: ' || p_guest_names || E'\n' ||
               'Entrada: ' || p_check_in || E'\n' ||
               'Saída: ' || p_check_out || E'\n' ||
               'Acesse https://vfbortolli.github.io/floripa-admin/ para aprovar';

  -- Insert notification record
  INSERT INTO whatsapp_notifications (phone, reservation_id, message, status)
  VALUES (p_recipient_phone, p_reservation_id, v_message, 'pending')
  RETURNING id INTO v_notification_id;

  -- Note: The actual sending via WhatsApp Cloud API should be done via an Edge Function
  -- or a backend service that has the access token. For now, we just record the notification.
  -- The client-side JS will need to handle the actual API call or trigger an Edge Function.

  RETURN json_build_object(
    'notification_id', v_notification_id,
    'phone', p_recipient_phone,
    'message', v_message,
    'status', 'pending'
  );
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION send_whatsapp_notification(bigint, text, text, text, text, text) TO authenticated, anon;
