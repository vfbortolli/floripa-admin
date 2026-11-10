-- Totais recebidos de diarias para o painel financeiro.
-- Execute depois da phase2q.sql e antes de publicar a versao correspondente do app.

create or replace function get_finance_daily_received(p_year int)
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
  with paid_reservations as (
    select
      r.id as res_id,
      sum(gc.rate * (r.check_out - r.check_in))::numeric as amount
    from reservations r
    join reservation_guests g on g.reservation_id = r.id and not g.exempt
    join guest_charges gc on gc.guest_id = g.id and gc.paid
    where r.status = 'confirmed'
      and r.kind = 'stay'
      and r.check_out >= make_date(p_year, 1, 1)
      and r.check_out < make_date(p_year + 1, 1, 1)
    group by r.id
  )
  select
    daily.reservation_id,
    daily.family_id,
    daily.period_month,
    least(daily.amount, coalesce(paid.amount, 0))::numeric
  from get_finance_daily(p_year) daily
  left join paid_reservations paid on paid.res_id = daily.reservation_id;
end $$;

revoke all on function get_finance_daily_received(int) from public, anon;
grant execute on function get_finance_daily_received(int) to authenticated;
