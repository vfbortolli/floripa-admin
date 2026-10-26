-- Fase 2 (etapa G): controle financeiro anual e mensal.
-- Execute depois da phase2f.sql: Supabase > SQL Editor > New query > Run

create table if not exists finance_categories (
  id bigserial primary key,
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (length(trim(name)) > 0),
  active boolean not null default true,
  unique (id, kind)
);
create unique index if not exists finance_categories_name_idx
  on finance_categories (kind, lower(name));

insert into finance_categories (kind, name)
select 'expense', v.name
from (values
  ('IPTU'), ('Taxa Lixo'), ('Água'), ('Luz 1'), ('Luz 2'), ('Limpeza'),
  ('Obras'), ('Despesas extraordinárias'), ('Móveis e utensílios'), ('Outros'), ('Tarifas')
) as v(name)
where not exists (
  select 1 from finance_categories c where c.kind = 'expense' and lower(c.name) = lower(v.name)
);
insert into finance_categories (kind, name)
select 'income', 'Outras receitas'
where not exists (
  select 1 from finance_categories where kind = 'income' and lower(name) = lower('Outras receitas')
);

create table if not exists finance_memberships (
  id bigserial primary key,
  family_id int not null references families(id),
  period_month date not null check (extract(day from period_month) = 1),
  expected_amount numeric(12, 2) not null default 0 check (expected_amount >= 0),
  received_amount numeric(12, 2) not null default 0 check (received_amount >= 0),
  paid_at date,
  unique (family_id, period_month)
);

create table if not exists finance_transactions (
  id bigserial primary key,
  kind text not null check (kind in ('income', 'expense')),
  category_id bigint not null,
  transaction_date date not null,
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  constraint finance_transactions_category_fk
    foreign key (category_id, kind) references finance_categories(id, kind)
);
create index if not exists finance_transactions_date_idx
  on finance_transactions (transaction_date);

create table if not exists finance_daily_adjustments (
  id bigserial primary key,
  family_id int not null references families(id),
  period_month date not null check (extract(day from period_month) = 1),
  amount numeric(12, 2) not null check (amount >= 0),
  unique (family_id, period_month)
);

alter table finance_categories enable row level security;
alter table finance_memberships enable row level security;
alter table finance_transactions enable row level security;
alter table finance_daily_adjustments enable row level security;

drop policy if exists finance_categories_admin on finance_categories;
create policy finance_categories_admin on finance_categories for all
  using (is_admin()) with check (is_admin());
drop policy if exists finance_memberships_admin on finance_memberships;
create policy finance_memberships_admin on finance_memberships for all
  using (is_admin()) with check (is_admin());
drop policy if exists finance_transactions_admin on finance_transactions;
create policy finance_transactions_admin on finance_transactions for all
  using (is_admin()) with check (is_admin());
drop policy if exists finance_daily_adjustments_admin on finance_daily_adjustments;
create policy finance_daily_adjustments_admin on finance_daily_adjustments for all
  using (is_admin()) with check (is_admin());

revoke all on finance_categories, finance_memberships, finance_transactions, finance_daily_adjustments
  from public, anon;
grant select, insert, update, delete on finance_categories, finance_memberships, finance_transactions, finance_daily_adjustments
  to authenticated;
grant usage, select on sequence
  finance_categories_id_seq, finance_memberships_id_seq,
  finance_transactions_id_seq, finance_daily_adjustments_id_seq
  to authenticated;

create or replace function get_finance_daily(p_year int)
returns table (reservation_id bigint, family_id int, period_month date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Somente administradores podem consultar o financeiro.';
  end if;
  if p_year < 1900 or p_year > 9998 then
    raise exception 'Ano inválido.';
  end if;

  return query
  with months as (
    select generate_series(
      make_date(p_year, 1, 1)::timestamp,
      make_date(p_year, 12, 1)::timestamp,
      interval '1 month'
    )::date as month_start
  ), guest_amounts as (
    select
      r.id as res_id,
      coalesce(guest_user.family_id, guest_name.family_id, s.family_id, creator.family_id) as assigned_family_id,
      r.check_in,
      r.check_out,
      gc.rate
    from reservations r
    join reservation_guests g on g.reservation_id = r.id and not g.exempt
    join guest_charges gc on gc.guest_id = g.id
    join spaces s on s.id = r.space_id
    left join allowed_users guest_user on guest_user.email = lower(g.user_email)
    left join lateral (
      select min(u.family_id) as family_id
      from allowed_users u
      where u.family_id is not null and lower(trim(u.name)) = lower(trim(g.name))
      having count(distinct u.family_id) = 1
    ) guest_name on true
    left join allowed_users creator on creator.email = lower(r.created_by)
    where r.status = 'confirmed'
      and r.kind = 'stay'
      and r.check_in < make_date(p_year + 1, 1, 1)
      and r.check_out > make_date(p_year, 1, 1)
  )
  select
    ga.res_id,
    ga.assigned_family_id,
    m.month_start,
    sum(ga.rate * (least(ga.check_out, (m.month_start + interval '1 month')::date)
      - greatest(ga.check_in, m.month_start)))::numeric
  from guest_amounts ga
  join months m on m.month_start < ga.check_out
    and (m.month_start + interval '1 month')::date > ga.check_in
  where ga.assigned_family_id is not null
  group by ga.res_id, ga.assigned_family_id, m.month_start;
end $$;
revoke all on function get_finance_daily(int) from public, anon;
grant execute on function get_finance_daily(int) to authenticated;

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
  elsif tg_table_name = 'finance_transactions' then
    label := src ->> 'description';
  else
    label := src ->> 'name';
  end if;

  insert into audit_log (actor, tbl, op, row_id, label, old_data, new_data)
  values (
    coalesce(lower(auth.jwt() ->> 'email'), 'sistema'), tg_table_name, tg_op,
    coalesce(src ->> 'id', src ->> 'family_id'), label, old_row, new_row
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'finance_categories', 'finance_memberships', 'finance_transactions', 'finance_daily_adjustments'
  ] loop
    execute format('drop trigger if exists trg_finance_audit on %I', t);
    execute format(
      'create trigger trg_finance_audit after insert or update or delete on %I for each row execute function log_finance_change()',
      t
    );
  end loop;
end $$;

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
    'finance_transactions', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_transactions t),
    'finance_daily_adjustments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from finance_daily_adjustments t)
  );
end $$;
