-- Execute no Supabase: SQL Editor > New query > Run

create table if not exists families (
  id serial primary key,
  name text not null unique
);

create table if not exists spaces (
  id serial primary key,
  name text not null unique,
  kind text not null check (kind in ('common', 'personal')),
  family_id int references families(id),
  sort int not null default 0
);

-- Lista de pessoas autorizadas a entrar (por e-mail, em minúsculas)
create table if not exists allowed_users (
  email text primary key check (email = lower(email)),
  name text,
  is_admin boolean not null default false,
  family_id int references families(id),
  is_responsible boolean not null default false
);

create table if not exists items (
  id bigserial primary key,
  space_id int not null references spaces(id) on delete cascade,
  description text not null,
  quantity int,
  condition text not null default 'bom' check (condition in ('bom', 'reparo', 'inutilizavel')),
  notes text,
  updated_at timestamptz not null default now()
);
create index if not exists items_space_idx on items(space_id);

create or replace function is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_users where email = lower(auth.jwt() ->> 'email'))
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from allowed_users where email = lower(auth.jwt() ->> 'email') and is_admin)
$$;

create or replace function can_edit_space(sp int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from spaces s, allowed_users u
    where s.id = sp
      and u.email = lower(auth.jwt() ->> 'email')
      and (
        (s.kind = 'common' and u.is_admin)
        or (s.kind = 'personal' and u.is_responsible and u.family_id = s.family_id)
      )
  )
$$;

-- Usada pelo keep-alive semanal para evitar a pausa do projeto gratuito
create or replace function ping() returns text
language sql stable as $$ select 'ok' $$;
grant execute on function ping() to anon;

alter table families enable row level security;
alter table spaces enable row level security;
alter table allowed_users enable row level security;
alter table items enable row level security;

create policy families_read on families for select using (is_allowed());
create policy spaces_read on spaces for select using (is_allowed());

create policy users_read on allowed_users for select
  using (email = lower(auth.jwt() ->> 'email') or is_admin());
create policy users_admin_write on allowed_users for all
  using (is_admin()) with check (is_admin());

create policy items_read on items for select using (is_allowed());
create policy items_insert on items for insert with check (can_edit_space(space_id));
create policy items_update on items for update
  using (can_edit_space(space_id)) with check (can_edit_space(space_id));
create policy items_delete on items for delete using (can_edit_space(space_id));

-- Dados iniciais
insert into families (name) values
  ('Bortolli'), ('Carneiro'), ('Della Rovere'), ('Nigro'), ('Marcia')
on conflict do nothing;

insert into spaces (name, kind, family_id, sort)
select v.name, 'common', null, v.sort from (values
  ('Quarto 1', 1), ('Quarto 2', 2), ('Quarto 3', 3),
  ('Banheiro 1', 4), ('Banheiro 2', 5),
  ('Cozinha', 6), ('Sala', 7), ('Lavabo externo', 8)
) as v(name, sort)
on conflict do nothing;

insert into spaces (name, kind, family_id, sort)
select 'Quarto ' || f.name, 'personal', f.id, 100 + f.id from families f
on conflict do nothing;

-- Primeiro administrador (responsável da família Bortolli)
insert into allowed_users (email, name, is_admin, family_id, is_responsible)
select 'vfbortolli@gmail.com', 'Bortolli', true, f.id, true
from families f where f.name = 'Bortolli'
on conflict (email) do nothing;
