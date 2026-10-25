-- Histórico de alterações (só administradores leem).
-- Execute no Supabase depois da phase2d.sql: SQL Editor > New query > Run

create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  tbl text not null,
  op text not null check (op in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  label text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists audit_log_at_idx on audit_log (at desc);

alter table audit_log enable row level security;
drop policy if exists audit_read on audit_log;
create policy audit_read on audit_log for select using (is_admin());

create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb; n jsonb; src jsonb;
  d_old jsonb := '{}'; d_new jsonb := '{}';
  k text; lbl text; sp text;
begin
  o := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  n := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  src := coalesce(n, o);

  if TG_OP = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (n -> k) is distinct from (o -> k) then
        d_old := d_old || jsonb_build_object(k, o -> k);
        d_new := d_new || jsonb_build_object(k, n -> k);
      end if;
    end loop;
    if d_new = '{}'::jsonb then return null; end if;
  else
    d_old := o;
    d_new := n;
  end if;

  if TG_TABLE_NAME = 'items' then
    select name into sp from spaces where id = (src ->> 'space_id')::int;
    lbl := (src ->> 'description') || ' (' || coalesce(sp, '?') || ')';
  elsif TG_TABLE_NAME = 'reservations' then
    select name into sp from spaces where id = (src ->> 'space_id')::int;
    lbl := coalesce(sp, '?') || ' ' || (src ->> 'check_in') || ' → ' || (src ->> 'check_out');
  elsif TG_TABLE_NAME = 'reservation_guests' then
    lbl := src ->> 'name';
  elsif TG_TABLE_NAME = 'allowed_users' then
    lbl := coalesce(src ->> 'name', src ->> 'email');
  elsif TG_TABLE_NAME = 'guest_charges' then
    select name into lbl from reservation_guests where id = (src ->> 'guest_id')::bigint;
  else
    lbl := src ->> 'key';
  end if;

  insert into audit_log (actor, tbl, op, row_id, label, old_data, new_data)
  values (
    coalesce(lower(auth.jwt() ->> 'email'), 'sistema'), TG_TABLE_NAME, TG_OP,
    coalesce(src ->> 'id', src ->> 'email', src ->> 'key', src ->> 'guest_id'),
    lbl, d_old, d_new
  );
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['items', 'reservations', 'reservation_guests', 'allowed_users', 'settings'] loop
    execute format('drop trigger if exists trg_audit on %I', t);
    execute format('create trigger trg_audit after insert or update or delete on %I for each row execute function log_change()', t);
  end loop;
end $$;

-- Cobranças: só mudanças (marcar como pago); a criação já aparece na reserva
drop trigger if exists trg_audit on guest_charges;
create trigger trg_audit after update on guest_charges
for each row execute function log_change();
