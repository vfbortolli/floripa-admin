-- Cobrança: marcar valores como pagos (só administradores).
-- Execute no Supabase depois da phase2b.sql: SQL Editor > New query > Run

alter table guest_charges add column if not exists paid boolean not null default false;
alter table guest_charges add column if not exists paid_at timestamptz;

drop policy if exists charges_admin_update on guest_charges;
create policy charges_admin_update on guest_charges for update
  using (is_admin()) with check (is_admin());
