-- Add phone field to allowed_users table
ALTER TABLE allowed_users ADD COLUMN IF NOT EXISTS phone text;

-- Create a table to store WhatsApp notifications (audit trail)
CREATE TABLE IF NOT EXISTS whatsapp_notifications (
  id bigserial primary key,
  phone text not null,
  reservation_id bigint references reservations(id) on delete cascade,
  message text not null,
  status text not null check (status in ('pending', 'sent', 'failed')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS whatsapp_notifications_phone_idx ON whatsapp_notifications(phone);
CREATE INDEX IF NOT EXISTS whatsapp_notifications_reservation_idx ON whatsapp_notifications(reservation_id);

-- Enable RLS
ALTER TABLE whatsapp_notifications ENABLE ROW LEVEL SECURITY;

-- Only admins and the person who receives the message can read their own notifications
CREATE POLICY whatsapp_notifications_read ON whatsapp_notifications
  FOR SELECT USING (
    is_admin() OR 
    (phone = ANY (
      SELECT phone FROM allowed_users WHERE email = lower(auth.jwt() ->> 'email')
    ))
  );

-- Only system functions can insert
CREATE POLICY whatsapp_notifications_insert ON whatsapp_notifications
  FOR INSERT WITH CHECK (is_admin());
