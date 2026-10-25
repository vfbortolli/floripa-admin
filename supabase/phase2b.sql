-- Fase 2 (etapa B): quartos pessoais com solicitação e aprovação.
-- Execute no Supabase depois da phase2a.sql: SQL Editor > New query > Run

create or replace function is_reservable_personal(sp int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from spaces s where s.id = sp and s.kind = 'personal' and s.reservable)
$$;

create or replace function me_email() returns text
language sql stable as $$ select lower(auth.jwt() ->> 'email') $$;

drop policy if exists res_insert on reservations;
drop policy if exists res_update on reservations;

-- Quarto comunitário: confirmado na hora. Quarto pessoal: pendente, a menos que o dono reserve.
create policy res_insert on reservations for insert with check (
  is_allowed() and created_by = me_email()
  and (kind = 'stay' or is_admin())
  and (
    (is_reservable_common(space_id) and status = 'confirmed')
    or (is_reservable_personal(space_id) and (
      status = 'pending' or (status = 'confirmed' and (can_edit_space(space_id) or is_admin()))
    ))
  )
);

create policy res_update on reservations for update
  using (created_by = me_email() or is_admin())
  with check (
    is_allowed() and (created_by = me_email() or is_admin())
    and (kind = 'stay' or is_admin())
    and (
      (is_reservable_common(space_id) and status = 'confirmed')
      or (is_reservable_personal(space_id) and (
        status = 'pending' or (status = 'confirmed' and (can_edit_space(space_id) or is_admin()))
      ))
    )
  );

-- Aprovar uma solicitação. Só o dono do quarto ou um admin.
-- Se houver conflito: só admin pode substituir (p_replace = true); caso contrário, erro.
create or replace function approve_reservation(p_id bigint, p_replace boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  select * into r from reservations where id = p_id;
  if not found or r.status <> 'pending' then
    raise exception 'Solicitação não encontrada ou já resolvida.';
  end if;
  if not (can_edit_space(r.space_id) or is_admin()) then
    raise exception 'Sem permissão para aprovar.';
  end if;
  if exists (
    select 1 from reservations o
    where o.space_id = r.space_id and o.status = 'confirmed' and o.id <> r.id
      and daterange(o.check_in, o.check_out) && daterange(r.check_in, r.check_out)
  ) then
    if not p_replace then
      raise exception 'CONFLITO: já existe reserva confirmada nesse período.';
    end if;
    if not is_admin() then
      raise exception 'Só um administrador pode substituir uma reserva confirmada.';
    end if;
    update reservations set status = 'rejected'
    where space_id = r.space_id and status = 'confirmed' and id <> r.id
      and daterange(check_in, check_out) && daterange(r.check_in, r.check_out);
  end if;
  update reservations set status = 'confirmed' where id = p_id;
end $$;

create or replace function reject_reservation(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare r reservations;
begin
  select * into r from reservations where id = p_id;
  if not found or r.status <> 'pending' then
    raise exception 'Solicitação não encontrada ou já resolvida.';
  end if;
  if not (can_edit_space(r.space_id) or is_admin()) then
    raise exception 'Sem permissão para recusar.';
  end if;
  update reservations set status = 'rejected' where id = p_id;
end $$;
