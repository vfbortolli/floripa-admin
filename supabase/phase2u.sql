-- Impede alteracoes em reservas e hospedes depois da data de saida.
-- Execute depois da phase2t.sql e antes de publicar a versao correspondente do app.

create or replace function prevent_completed_reservation_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  checkout_date date;
begin
  if tg_table_name = 'reservations' then
    if current_date > old.check_out
      or (tg_op = 'UPDATE' and current_date > new.check_out) then
      raise exception 'RESERVATION_FINISHED: esta reserva ja terminou e nao pode mais ser alterada.';
    end if;
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op <> 'INSERT' then
    select check_out into checkout_date
    from reservations where id = old.reservation_id;
    if found and current_date > checkout_date then
      raise exception 'RESERVATION_FINISHED: esta reserva ja terminou e nao pode mais ser alterada.';
    end if;
  end if;

  if tg_op <> 'DELETE' then
    select check_out into checkout_date
    from reservations where id = new.reservation_id;
    if found and current_date > checkout_date then
      raise exception 'RESERVATION_FINISHED: esta reserva ja terminou e nao pode mais ser alterada.';
    end if;
    return new;
  end if;

  return old;
end $$;

drop trigger if exists trg_prevent_completed_reservation_changes on reservations;
create trigger trg_prevent_completed_reservation_changes
before update or delete on reservations
for each row execute function prevent_completed_reservation_changes();

drop trigger if exists trg_prevent_completed_reservation_guest_changes on reservation_guests;
create trigger trg_prevent_completed_reservation_guest_changes
before insert or update or delete on reservation_guests
for each row execute function prevent_completed_reservation_changes();
