-- Backup: exporta todos os dados em JSON (só administradores).
-- Execute no Supabase depois da phase2c.sql: SQL Editor > New query > Run

create or replace function export_backup() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Somente administradores.';
  end if;
  return jsonb_build_object(
    'generated_at', now(),
    'families', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from families t),
    'spaces', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from spaces t),
    'allowed_users', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from allowed_users t),
    'items', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from items t),
    'settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from settings t),
    'reservations', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from reservations t),
    'reservation_guests', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from reservation_guests t),
    'guest_charges', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from guest_charges t)
  );
end $$;
