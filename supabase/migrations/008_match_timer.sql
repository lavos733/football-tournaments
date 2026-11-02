-- Таймер матча: длительность задаётся в турнире (5–20 минут), идёт обратный отсчёт.
-- Состояние таймера хранится в матче, чтобы все судьи видели одно и то же время.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–007)

alter table public.tournaments
  add column if not exists match_minutes smallint not null default 10 check (match_minutes between 5 and 20);
grant update (name, format, rounds, mvp_player_id, match_minutes) on public.tournaments to authenticated;

-- timer_left — сколько секунд оставалось в момент timer_since; timer_since = null — таймер на паузе
alter table public.matches
  add column if not exists timer_left  integer check (timer_left >= 0),
  add column if not exists timer_since timestamptz;

-- остаток на текущий момент
create or replace function public.match_timer_left(m matches)
returns integer language sql stable as $$
  select case
    when m.timer_left is null then null
    when m.timer_since is null then m.timer_left
    else greatest(0, m.timer_left - floor(extract(epoch from now() - m.timer_since))::int)
  end;
$$;

create or replace function public.set_match_status(p_match uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  m matches;
begin
  if not public.can_edit_match(p_match) then
    raise exception 'Менять матч могут организатор и судьи, пока турнир идёт';
  end if;
  if p_status not in ('scheduled', 'live', 'finished') then raise exception 'Неизвестный статус'; end if;
  select * into m from matches where id = p_match;

  if p_status = 'scheduled' then
    if exists (select 1 from match_events where match_id = p_match) then
      raise exception 'В матче уже есть события — сначала удалите их';
    end if;
    update matches set status = 'scheduled', home_score = null, away_score = null, timer_left = null, timer_since = null
    where id = p_match;
  else
    if p_status = 'live' and m.status = 'scheduled' then
      -- старт матча запускает таймер на полную длительность
      update matches set status = 'live',
        timer_left = (select match_minutes * 60 from tournaments where id = m.tournament_id),
        timer_since = now()
      where id = p_match;
    elsif p_status = 'finished' then
      -- завершение останавливает таймер; «Исправить результат» его не перезапускает
      update matches set status = 'finished', timer_left = public.match_timer_left(m), timer_since = null where id = p_match;
    else
      update matches set status = p_status where id = p_match;
    end if;
    perform public.recalc_match_score(p_match);
  end if;
end $$;

-- p_action: 'pause' | 'resume' | 'adjust' (p_delta — секунды, можно отрицательные)
create or replace function public.match_timer(p_match uuid, p_action text, p_delta integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare
  m      matches;
  v_left integer;
begin
  if not public.can_edit_match(p_match) then
    raise exception 'Менять матч могут организатор и судьи, пока турнир идёт';
  end if;
  select * into m from matches where id = p_match;
  if m.status <> 'live' then raise exception 'Таймер работает только в идущем матче'; end if;
  v_left := coalesce(public.match_timer_left(m), (select match_minutes * 60 from tournaments where id = m.tournament_id));

  if p_action = 'pause' then
    update matches set timer_left = v_left, timer_since = null where id = p_match;
  elsif p_action = 'resume' then
    update matches set timer_left = v_left, timer_since = now() where id = p_match;
  elsif p_action = 'adjust' then
    update matches set timer_left = greatest(0, v_left + p_delta),
      timer_since = case when m.timer_since is null then null else now() end
    where id = p_match;
  else
    raise exception 'Неизвестное действие таймера';
  end if;
end $$;

grant execute on function public.match_timer(uuid, text, integer) to authenticated;

-- серверное время: клиент поправляет по нему свои часы, чтобы таймер у всех совпадал
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now(); $$;
grant execute on function public.server_now() to anon, authenticated;
