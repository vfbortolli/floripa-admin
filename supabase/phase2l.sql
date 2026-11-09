-- Fase 2 (etapa L): leitura do Financeiro para todos os usuarios autorizados.
-- Execute depois da phase2k.sql: Supabase > SQL Editor > New query > Run

drop policy if exists finance_categories_admin on finance_categories;
drop policy if exists finance_categories_read on finance_categories;
create policy finance_categories_read on finance_categories for select to authenticated
  using (is_allowed());
create policy finance_categories_admin on finance_categories for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists finance_memberships_admin on finance_memberships;
drop policy if exists finance_memberships_read on finance_memberships;
create policy finance_memberships_read on finance_memberships for select to authenticated
  using (is_allowed());
create policy finance_memberships_admin on finance_memberships for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists finance_transactions_admin on finance_transactions;
drop policy if exists finance_transactions_read on finance_transactions;
create policy finance_transactions_read on finance_transactions for select to authenticated
  using (is_allowed());
create policy finance_transactions_admin on finance_transactions for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists finance_daily_adjustments_admin on finance_daily_adjustments;
drop policy if exists finance_daily_adjustments_read on finance_daily_adjustments;
create policy finance_daily_adjustments_read on finance_daily_adjustments for select to authenticated
  using (is_allowed());
create policy finance_daily_adjustments_admin on finance_daily_adjustments for all to authenticated
  using (is_admin()) with check (is_admin());

drop policy if exists finance_membership_rates_admin on finance_membership_rates;
drop policy if exists finance_membership_rates_read on finance_membership_rates;
create policy finance_membership_rates_read on finance_membership_rates for select to authenticated
  using (is_allowed());
create policy finance_membership_rates_admin on finance_membership_rates for all to authenticated
  using (is_admin()) with check (is_admin());

create or replace function get_finance_daily(p_year int)
returns table (reservation_id bigint, family_id int, period_month date, amount numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_allowed() then
    raise exception 'Somente usuarios autorizados podem consultar o financeiro.';
  end if;
  if p_year < 1900 or p_year > 9998 then
    raise exception 'Ano invalido.';
  end if;

  return query
  with guest_families as (
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
      and r.check_out >= make_date(p_year, 1, 1)
      and r.check_out < make_date(p_year + 1, 1, 1)
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
  )
  select
    gf.res_id,
    rf.assigned_family_id,
    date_trunc('month', gf.check_out)::date,
    sum(gf.rate * (gf.check_out - gf.check_in))::numeric
  from guest_families gf
  join reservation_families rf on rf.res_id = gf.res_id
  where not gf.exempt
    and gf.rate is not null
    and rf.assigned_family_id is not null
  group by gf.res_id, rf.assigned_family_id, date_trunc('month', gf.check_out)::date;
end $$;

revoke all on function get_finance_daily(int) from public, anon;
grant execute on function get_finance_daily(int) to authenticated;
