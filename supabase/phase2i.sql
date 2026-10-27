-- Fase 2 (etapa I): atribui diárias sem família identificada à família do criador da reserva.
-- Execute depois da phase2h.sql: Supabase > SQL Editor > New query > Run

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
  ), guest_families as (
    select
      r.id as res_id,
      g.id as guest_id,
      g.exempt,
      coalesce(guest_user.family_id, guest_name.family_id) as guest_family_id,
      creator.family_id as creator_family_id,
      (
        lower(trim(g.user_email)) = lower(trim(r.created_by))
        or (
          creator.name is not null
          and lower(trim(g.name)) = lower(trim(creator.name))
        )
      ) as is_creator,
      r.check_in,
      r.check_out,
      gc.rate
    from reservations r
    join reservation_guests g on g.reservation_id = r.id
    left join guest_charges gc on gc.guest_id = g.id
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
  ), reservation_families as (
    select distinct on (res_id)
      res_id,
      coalesce(
        case when is_creator then coalesce(guest_family_id, creator_family_id) end,
        guest_family_id,
        creator_family_id
      ) as assigned_family_id
    from guest_families
    order by res_id,
      case
        when is_creator and coalesce(guest_family_id, creator_family_id) is not null then 0
        when guest_family_id is not null then 1
        else 2
      end,
      guest_id
  ), guest_amounts as (
    select
      g.res_id,
      rf.assigned_family_id,
      g.check_in,
      g.check_out,
      g.rate
    from guest_families g
    join reservation_families rf on rf.res_id = g.res_id
    where not g.exempt and g.rate is not null
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
