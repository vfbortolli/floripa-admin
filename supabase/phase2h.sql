-- Fase 2 (etapa H): valor anual padrão das mensalidades.
-- Execute depois da phase2g.sql: Supabase > SQL Editor > New query > Run

create table if not exists finance_membership_rates (
  year int primary key check (year between 1900 and 9998),
  amount numeric(12, 2) not null check (amount >= 0)
);

insert into finance_membership_rates (year, amount)
values (2026, 300)
on conflict (year) do nothing;

alter table finance_membership_rates enable row level security;
drop policy if exists finance_membership_rates_admin on finance_membership_rates;
create policy finance_membership_rates_admin on finance_membership_rates for all
  using (is_admin()) with check (is_admin());

revoke all on finance_membership_rates from public, anon;
grant select, insert, update, delete on finance_membership_rates to authenticated;

create or replace function apply_finance_membership_rate() returns trigger
language plpgsql set search_path = public as $$
declare
  annual_amount numeric(12, 2);
begin
  select amount into annual_amount
  from finance_membership_rates
  where year = extract(year from new.period_month)::int;

  if found then
    new.expected_amount := annual_amount;
  end if;
  return new;
end $$;

drop trigger if exists trg_finance_membership_rate on finance_memberships;
create trigger trg_finance_membership_rate
  before insert or update on finance_memberships
  for each row execute function apply_finance_membership_rate();

create or replace function sync_finance_membership_rate() returns trigger
language plpgsql set search_path = public as $$
begin
  update finance_memberships
  set expected_amount = new.amount
  where period_month >= make_date(new.year, 1, 1)
    and period_month < make_date(new.year + 1, 1, 1)
    and expected_amount <> new.amount;
  return null;
end $$;

drop trigger if exists trg_sync_finance_membership_rate on finance_membership_rates;
create trigger trg_sync_finance_membership_rate
  after insert or update on finance_membership_rates
  for each row execute function sync_finance_membership_rate();

update finance_memberships m
set expected_amount = r.amount
from finance_membership_rates r
where m.period_month >= make_date(r.year, 1, 1)
  and m.period_month < make_date(r.year + 1, 1, 1)
  and m.expected_amount <> r.amount;

create or replace function log_finance_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  old_row jsonb;
  new_row jsonb;
  src jsonb;
  family_name text;
  label text;
begin
  old_row := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_row := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  src := coalesce(new_row, old_row);

  if tg_table_name = 'finance_memberships' or tg_table_name = 'finance_daily_adjustments' then
    select name into family_name from families where id = (src ->> 'family_id')::int;
    label := coalesce(family_name, 'Família') || ' · ' || (src ->> 'period_month');
  elsif tg_table_name = 'finance_membership_rates' then
    label := 'Mensalidade · ' || (src ->> 'year');
  elsif tg_table_name = 'finance_transactions' then
    label := src ->> 'description';
  else
    label := src ->> 'name';
  end if;

  insert into audit_log (actor, tbl, op, row_id, label, old_data, new_data)
  values (
    coalesce(lower(auth.jwt() ->> 'email'), 'sistema'), tg_table_name, tg_op,
    coalesce(src ->> 'id', src ->> 'family_id', src ->> 'year'), label, old_row, new_row
  );
  return null;
end $$;

drop trigger if exists trg_finance_audit on finance_membership_rates;
create trigger trg_finance_audit
  after insert or update or delete on finance_membership_rates
  for each row execute function log_finance_change();

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
    'finance_memberships', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_memberships t),
    'finance_membership_rates', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_membership_rates t),
    'finance_transactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_transactions t),
    'finance_daily_adjustments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_daily_adjustments t)
  );
end $$;
