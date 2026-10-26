-- Fase 2 (etapa F): limitar a exposição de e-mails e tarifas.
-- Execute depois da phase2e.sql: SQL Editor > New query > Run

create or replace function list_people() returns table (name text, email text, family_id int)
language sql stable security definer set search_path = public as $$
  select u.name,
    case when is_admin() or u.email = me_email() then u.email else null end,
    u.family_id
  from allowed_users u
  where is_allowed()
$$;

create or replace function get_rates() returns table (key text, value numeric)
language sql stable security definer set search_path = public as $$
  select s.key, s.value from settings s where is_admin()
$$;

alter table reservations add column if not exists created_by_name text;
update reservations r
set created_by_name = coalesce(u.name, 'Pessoa cadastrada')
from allowed_users u
where lower(r.created_by) = u.email and r.created_by_name is null;
update reservations
set created_by_name = 'Pessoa cadastrada'
where created_by_name is null;

create or replace function set_reservation_creator_name() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce(u.name, 'Pessoa cadastrada') into new.created_by_name
  from allowed_users u
  where u.email = lower(new.created_by);
  new.created_by_name := coalesce(new.created_by_name, 'Pessoa cadastrada');
  return new;
end $$;

drop trigger if exists trg_reservation_creator_name on reservations;
create trigger trg_reservation_creator_name
before insert or update of created_by on reservations
for each row execute function set_reservation_creator_name();

create or replace function my_reservation_ids() returns table (id bigint)
language sql stable security definer set search_path = public as $$
  select r.id
  from reservations r
  where is_allowed() and r.created_by = me_email()
$$;
revoke all on function my_reservation_ids() from public, anon;
grant execute on function my_reservation_ids() to authenticated;

revoke select, insert, update on table reservations from public, anon, authenticated;
grant select (id, space_id, check_in, check_out, kind, status, note, created_at, created_by_name)
  on table reservations to authenticated;
grant insert (space_id, check_in, check_out, kind, status, created_by, note)
  on table reservations to authenticated;
grant update (space_id, check_in, check_out, kind, status, note)
  on table reservations to authenticated;
grant delete on table reservations to authenticated;

revoke select, insert, update on table reservation_guests from public, anon, authenticated;
grant select (id, reservation_id, name, type, exempt)
  on table reservation_guests to authenticated;
grant insert (reservation_id, name, type, exempt)
  on table reservation_guests to authenticated;
grant update (name, type, exempt)
  on table reservation_guests to authenticated;
grant delete on table reservation_guests to authenticated;
