-- Тайм-коды событий матча: сколько секунд прошло с начала матча в момент гола, карточки или автогола.
-- Время фиксирует приложение судьи в момент нажатия кнопки «Гол»/карточки (по таймеру матча, сверенному
-- с часами сервера), а не в момент сохранения — иначе выбор игроков добавлял бы до 30 секунд.
-- Сервер лишь не даёт поставить время позже текущего; если время не передано — ставит текущее по таймеру.
-- У событий, добавленных до этой миграции, времени нет (null).
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–011). Можно запускать повторно.

alter table public.match_events add column if not exists match_second integer check (match_second >= 0);

create or replace function public.set_match_event_time()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m        matches;
  v_total  integer;
  v_left   integer;
  v_now    integer;
begin
  select * into m from matches where id = new.match_id;
  v_left := public.match_timer_left(m);
  if v_left is null then
    new.match_second := null;
    return new;
  end if;
  select match_minutes * 60 into v_total from tournaments where id = m.tournament_id;
  -- после «+время» остаток может стать больше длительности — тогда считаем от нуля
  v_now := greatest(0, v_total - v_left);
  new.match_second := least(coalesce(new.match_second, v_now), v_now);
  return new;
end $$;

drop trigger if exists match_events_time on public.match_events;
create trigger match_events_time
  before insert on public.match_events
  for each row execute function public.set_match_event_time();
