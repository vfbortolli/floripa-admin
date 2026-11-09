-- Fase 2 (etapa K): comprovantes privados para mensalidades e diarias.
-- Execute depois da phase2j.sql: Supabase > SQL Editor > New query > Run

create table if not exists payment_receipts (
  id bigserial primary key,
  object_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 120),
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid not null default auth.uid()
);

create table if not exists payment_receipt_memberships (
  receipt_id bigint not null references payment_receipts(id) on delete cascade,
  membership_id bigint not null references finance_memberships(id) on delete restrict,
  primary key (receipt_id, membership_id)
);

create table if not exists payment_receipt_guest_charges (
  receipt_id bigint not null references payment_receipts(id) on delete cascade,
  guest_id bigint not null references guest_charges(guest_id) on delete restrict,
  primary key (receipt_id, guest_id)
);

alter table payment_receipts enable row level security;
alter table payment_receipt_memberships enable row level security;
alter table payment_receipt_guest_charges enable row level security;

drop policy if exists payment_receipts_admin on payment_receipts;
create policy payment_receipts_admin on payment_receipts for all
  using (is_admin()) with check (is_admin());
drop policy if exists payment_receipt_memberships_admin on payment_receipt_memberships;
create policy payment_receipt_memberships_admin on payment_receipt_memberships for all
  using (is_admin()) with check (is_admin());
drop policy if exists payment_receipt_guest_charges_admin on payment_receipt_guest_charges;
create policy payment_receipt_guest_charges_admin on payment_receipt_guest_charges for all
  using (is_admin()) with check (is_admin());

revoke all on payment_receipts, payment_receipt_memberships, payment_receipt_guest_charges
  from public, anon;
grant select, insert, delete on payment_receipts, payment_receipt_memberships, payment_receipt_guest_charges
  to authenticated;
grant usage, select on sequence payment_receipts_id_seq to authenticated;

create or replace function require_membership_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.received_amount > 0
    and (tg_op = 'INSERT' or new.received_amount is distinct from old.received_amount
      or new.paid_at is distinct from old.paid_at)
    and not exists (
      select 1 from payment_receipt_memberships prm where prm.membership_id = new.id
    )
  then
    raise exception using errcode = '23514',
      message = 'Anexe um comprovante antes de registrar ou alterar um recebimento.';
  end if;
  return new;
end $$;

drop trigger if exists trg_membership_receipt_required on finance_memberships;
create trigger trg_membership_receipt_required
  before insert or update of received_amount, paid_at on finance_memberships
  for each row execute function require_membership_receipt();

create or replace function require_guest_charge_receipt() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.paid and not old.paid
    and not exists (
      select 1 from payment_receipt_guest_charges prg where prg.guest_id = new.guest_id
    )
  then
    raise exception using errcode = '23514',
      message = 'Anexe um comprovante antes de dar baixa na diaria.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guest_charge_receipt_required on guest_charges;
create trigger trg_guest_charge_receipt_required
  before update of paid on guest_charges
  for each row execute function require_guest_charge_receipt();

create or replace function protect_payment_receipt_membership() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from finance_memberships fm
    where fm.id = old.membership_id and fm.received_amount > 0
  ) then
    raise exception using errcode = '23514',
      message = 'Estorne o recebimento antes de remover seu comprovante.';
  end if;
  return old;
end $$;

drop trigger if exists trg_protect_payment_receipt_membership on payment_receipt_memberships;
create trigger trg_protect_payment_receipt_membership
  before delete on payment_receipt_memberships
  for each row execute function protect_payment_receipt_membership();

create or replace function protect_payment_receipt_guest_charge() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (
    select 1 from guest_charges gc
    where gc.guest_id = old.guest_id and gc.paid
  ) then
    raise exception using errcode = '23514',
      message = 'Estorne a baixa antes de remover seu comprovante.';
  end if;
  return old;
end $$;

drop trigger if exists trg_protect_payment_receipt_guest_charge on payment_receipt_guest_charges;
create trigger trg_protect_payment_receipt_guest_charge
  before delete on payment_receipt_guest_charges
  for each row execute function protect_payment_receipt_guest_charge();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists payment_proofs_admin_select on storage.objects;
create policy payment_proofs_admin_select on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and is_admin());
drop policy if exists payment_proofs_admin_insert on storage.objects;
create policy payment_proofs_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and is_admin());
drop policy if exists payment_proofs_admin_update on storage.objects;
create policy payment_proofs_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'payment-proofs' and is_admin())
  with check (bucket_id = 'payment-proofs' and is_admin());
drop policy if exists payment_proofs_admin_delete on storage.objects;
create policy payment_proofs_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and is_admin());

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
    'guest_charges', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from guest_charges t),
    'finance_categories', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_categories t),
    'finance_membership_rates', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_membership_rates t),
    'finance_memberships', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_memberships t),
    'finance_transactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_transactions t),
    'finance_daily_adjustments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_daily_adjustments t),
    'payment_receipts', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from payment_receipts t),
    'payment_receipt_memberships', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from payment_receipt_memberships t),
    'payment_receipt_guest_charges', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from payment_receipt_guest_charges t)
  );
end $$;
