-- Fase 2 (etapa A): agenda dos quartos comunitários e valores.
-- Execute no Supabase: SQL Editor > New query > Run

create extension if not exists btree_gist;

alter table spaces add column if not exists reservable boolean not null default false;
update spaces set reservable = true where name in ('Quarto 1', 'Quarto 2', 'Quarto 3') or kind = 'personal';

create table if not exists settings (
  key text primary key,
  value numeric not null
);
insert into settings (key, value) values ('rate_socio', 30), ('rate_convidado', 50)
on conflict do nothing;

create table if not exists reservations (
  id bigserial primary key,
  space_id int not null references spaces(id),
  check_in date not null,
  check_out date not null,
  kind text not null default 'stay' check (kind in ('stay', 'block')),
  status text not null default 'confirmed' check (status in ('confirmed', 'pending', 'rejected')),
  created_by text not null,
  note text,
  created_at timestamptz not null default now(),
  constraint dates_ok check (check_out > check_in),
  constraint no_overlap exclude using gist (
    space_id with =, daterange(check_in, check_out) with &&
  ) where (status = 'confirmed')
);
create index if not exists reservations_dates_idx on reservations (check_in, check_out);

create table if not exists reservation_guests (
  id bigserial primary key,
  reservation_id bigint not null references reservations(id) on delete cascade,
  name text not null,
  user_email text,
  type text not null check (type in ('socio', 'convidado')),
  exempt boolean not null default false
);
create index if not exists guests_res_idx on reservation_guests (reservation_id);

-- Valor por pessoa/noite guardado na criação; visível só ao dono da reserva e a admins
create table if not exists guest_charges (
  guest_id bigint primary key references reservation_guests(id) on delete cascade,
  rate numeric not null
);

create or replace function set_guest_charge() returns trigger
language plpgsql security definer set search_path = public as $$
declare r numeric;
begin
  select value into r from settings where key = 'rate_' || new.type;
  insert into guest_charges (guest_id, rate) values (new.id, coalesce(r, 0))
  on conflict (guest_id) do update set rate = excluded.rate;
  return new;
end $$;

drop trigger if exists trg_guest_charge on reservation_guests;
create trigger trg_guest_charge
after insert or update of type on reservation_guests
for each row execute function set_guest_charge();

create or replace function can_manage_reservation(rid bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reservations r
    where r.id = rid and (r.created_by = lower(auth.jwt() ->> 'email') or is_admin())
  )
$$;

create or replace function is_reservable_common(sp int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from spaces s where s.id = sp and s.kind = 'common' and s.reservable)
$$;

create or replace function list_people() returns table (name text, email text, family_id int)
language sql stable security definer set search_path = public as $$
  select u.name, u.email, u.family_id from allowed_users u where is_allowed()
$$;

create or replace function get_rates() returns table (key text, value numeric)
language sql stable security definer set search_path = public as $$
  select s.key, s.value from settings s where is_allowed()
$$;

alter table settings enable row level security;
alter table reservations enable row level security;
alter table reservation_guests enable row level security;
alter table guest_charges enable row level security;

drop policy if exists settings_admin on settings;
create policy settings_admin on settings for all using (is_admin()) with check (is_admin());

drop policy if exists res_read on reservations;
drop policy if exists res_insert on reservations;
drop policy if exists res_update on reservations;
drop policy if exists res_delete on reservations;
create policy res_read on reservations for select using (is_allowed());
create policy res_insert on reservations for insert with check (
  is_allowed() and status = 'confirmed' and is_reservable_common(space_id)
  and created_by = lower(auth.jwt() ->> 'email')
  and (kind = 'stay' or is_admin())
);
create policy res_update on reservations for update
  using (created_by = lower(auth.jwt() ->> 'email') or is_admin())
  with check (
    is_allowed() and status = 'confirmed' and is_reservable_common(space_id)
    and (kind = 'stay' or is_admin())
    and (created_by = lower(auth.jwt() ->> 'email') or is_admin())
  );
create policy res_delete on reservations for delete
  using (created_by = lower(auth.jwt() ->> 'email') or is_admin());

drop policy if exists guests_read on reservation_guests;
drop policy if exists guests_write on reservation_guests;
create policy guests_read on reservation_guests for select using (is_allowed());
create policy guests_write on reservation_guests for all
  using (can_manage_reservation(reservation_id))
  with check (can_manage_reservation(reservation_id));

drop policy if exists charges_read on guest_charges;
create policy charges_read on guest_charges for select using (
  exists (select 1 from reservation_guests g where g.id = guest_id and can_manage_reservation(g.reservation_id))
);
