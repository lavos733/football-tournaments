alter table public.tournaments
  add column if not exists mvp_player_id  uuid references public.players on delete set null,
  add column if not exists winner_team_id uuid references public.tournament_teams on delete set null;

-- Этап 2.1: лучший игрок — по итогам турнира (а не матча), победитель турнира, серии турниров.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–003)

-- ---------------------------------------------------------------------
-- Убираем «лучшего игрока матча»
-- ---------------------------------------------------------------------
drop view if exists public.player_stats;
drop view if exists public.player_tournament_stats;
drop trigger if exists matches_validate_mvp on public.matches;
drop function if exists public.validate_match_mvp();
alter table public.matches drop column if exists mvp_player_id;
revoke update on public.matches from anon, authenticated;

create or replace function public.set_match_status(p_match uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit_match(p_match) then
    raise exception 'Менять матч могут организатор и судьи, пока турнир идёт';
  end if;
  if p_status not in ('scheduled', 'live', 'finished') then raise exception 'Неизвестный статус'; end if;

  if p_status = 'scheduled' then
    if exists (select 1 from match_events where match_id = p_match) then
      raise exception 'В матче уже есть события — сначала удалите их';
    end if;
    update matches set status = 'scheduled', home_score = null, away_score = null where id = p_match;
  else
    update matches set status = p_status where id = p_match;
    perform public.recalc_match_score(p_match);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Лучший игрок турнира: организатор выбирает из заявленных игроков
-- ---------------------------------------------------------------------
grant update (name, format, rounds, mvp_player_id) on public.tournaments to authenticated;

create or replace function public.validate_tournament_mvp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.mvp_player_id is not null and new.mvp_player_id is distinct from old.mvp_player_id
     and not exists (select 1 from roster_entries where tournament_id = new.id and player_id = new.mvp_player_id) then
    raise exception 'Лучший игрок должен быть заявлен в этом турнире';
  end if;
  return new;
end $$;

drop trigger if exists tournaments_validate_mvp on public.tournaments;
create trigger tournaments_validate_mvp
  before update on public.tournaments
  for each row execute function public.validate_tournament_mvp();

-- Завершение: приложение считает таблицу и передаёт победителя
drop function if exists public.finish_tournament(uuid);
create or replace function public.finish_tournament(p_tournament uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if public.tournament_status(p_tournament) <> 'active' then raise exception 'Турнир не идёт'; end if;
  if exists (select 1 from matches where tournament_id = p_tournament and status <> 'finished') then
    raise exception 'Сначала завершите все матчи';
  end if;
  if not exists (select 1 from tournament_teams where id = p_winner and tournament_id = p_tournament) then
    raise exception 'Победитель должен быть командой этого турнира';
  end if;
  update tournaments set status = 'finished', winner_team_id = p_winner where id = p_tournament;
end $$;
grant execute on function public.finish_tournament(uuid, uuid) to authenticated;

create or replace function public.reopen_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if public.tournament_status(p_tournament) <> 'finished' then raise exception 'Турнир не завершён'; end if;
  update tournaments set status = 'active', winner_team_id = null where id = p_tournament;
end $$;

-- ---------------------------------------------------------------------
-- Серии: объединение нескольких турниров (например, все недельные турниры сезона)
-- ---------------------------------------------------------------------
create table public.series (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_by  uuid not null default auth.uid() references public.profiles on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.series_tournaments (
  series_id      uuid not null references public.series on delete cascade,
  tournament_id  uuid not null references public.tournaments on delete cascade,
  primary key (series_id, tournament_id)
);

alter table public.series             enable row level security;
alter table public.series_tournaments enable row level security;

create policy "read" on public.series             for select using (true);
create policy "read" on public.series_tournaments for select using (true);

create policy "insert" on public.series for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "update" on public.series for update to authenticated
  using (created_by = (select auth.uid()));
create policy "delete" on public.series for delete to authenticated
  using (created_by = (select auth.uid()));
revoke update on public.series from anon, authenticated;
grant update (name) on public.series to authenticated;

-- в серию можно добавить любой турнир (все турниры публичные); управляет создатель серии
create policy "manage" on public.series_tournaments for all to authenticated
  using (exists (select 1 from public.series s where s.id = series_id and s.created_by = (select auth.uid())))
  with check (exists (select 1 from public.series s where s.id = series_id and s.created_by = (select auth.uid())));

-- ---------------------------------------------------------------------
-- Статистика игроков (пересоздаём: MVP и титулы — по турнирам)
-- ---------------------------------------------------------------------
create view public.player_tournament_stats with (security_invoker = on) as
with apps as (
  select re.tournament_id, re.player_id,
    case when m.home_team_id = re.tournament_team_id then m.home_score else m.away_score end as gf,
    case when m.home_team_id = re.tournament_team_id then m.away_score else m.home_score end as ga
  from roster_entries re
  join matches m on m.tournament_id = re.tournament_id
    and m.status = 'finished'
    and re.tournament_team_id in (m.home_team_id, m.away_team_id)
  where not exists (select 1 from match_absences a where a.match_id = m.id and a.player_id = re.player_id)
),
app_agg as (
  select tournament_id, player_id,
    count(*) as matches,
    count(*) filter (where gf > ga) as wins,
    count(*) filter (where gf = ga) as draws,
    count(*) filter (where gf < ga) as losses
  from apps group by 1, 2
),
ev as (
  select m.tournament_id, e.player_id,
    count(*) filter (where e.type = 'goal') as goals,
    count(*) filter (where e.type = 'own_goal') as own_goals,
    count(*) filter (where e.type = 'yellow') as yellow_cards,
    count(*) filter (where e.type = 'red') as red_cards
  from match_events e join matches m on m.id = e.match_id
  where e.player_id is not null
  group by 1, 2
),
ast as (
  select m.tournament_id, e.assist_player_id as player_id, count(*) as assists
  from match_events e join matches m on m.id = e.match_id
  where e.assist_player_id is not null
  group by 1, 2
),
gk as (
  select m.tournament_id, g.player_id,
    count(*) as gk_matches,
    count(*) filter (where (case when g.team_id = m.home_team_id then m.away_score else m.home_score end) = 0) as clean_sheets,
    coalesce(sum(case when g.team_id = m.home_team_id then m.away_score else m.home_score end), 0) as goals_conceded
  from match_goalkeepers g join matches m on m.id = g.match_id and m.status = 'finished'
  group by 1, 2
)
select
  re.tournament_id,
  re.player_id,
  re.tournament_team_id as team_id,
  t.status as tournament_status,
  coalesce(a.matches, 0)::int         as matches,
  coalesce(a.wins, 0)::int            as wins,
  coalesce(a.draws, 0)::int           as draws,
  coalesce(a.losses, 0)::int          as losses,
  coalesce(ev.goals, 0)::int          as goals,
  coalesce(ast.assists, 0)::int       as assists,
  coalesce(ev.own_goals, 0)::int      as own_goals,
  coalesce(ev.yellow_cards, 0)::int   as yellow_cards,
  coalesce(ev.red_cards, 0)::int      as red_cards,
  coalesce((t.mvp_player_id = re.player_id)::int, 0)            as mvp,
  coalesce((t.winner_team_id = re.tournament_team_id)::int, 0)  as titles,
  coalesce(gk.gk_matches, 0)::int     as gk_matches,
  coalesce(gk.clean_sheets, 0)::int   as clean_sheets,
  coalesce(gk.goals_conceded, 0)::int as goals_conceded
from roster_entries re
join tournaments t on t.id = re.tournament_id
left join app_agg a on a.tournament_id = re.tournament_id and a.player_id = re.player_id
left join ev        on ev.tournament_id = re.tournament_id and ev.player_id = re.player_id
left join ast       on ast.tournament_id = re.tournament_id and ast.player_id = re.player_id
left join gk        on gk.tournament_id = re.tournament_id and gk.player_id = re.player_id;

create view public.player_stats with (security_invoker = on) as
select
  player_id,
  count(*) filter (where tournament_status <> 'draft')::int as tournaments,
  sum(matches)::int        as matches,
  sum(wins)::int           as wins,
  sum(draws)::int          as draws,
  sum(losses)::int         as losses,
  sum(goals)::int          as goals,
  sum(assists)::int        as assists,
  sum(own_goals)::int      as own_goals,
  sum(yellow_cards)::int   as yellow_cards,
  sum(red_cards)::int      as red_cards,
  coalesce(sum(mvp), 0)::int    as mvp,
  coalesce(sum(titles), 0)::int as titles,
  sum(gk_matches)::int     as gk_matches,
  sum(clean_sheets)::int   as clean_sheets,
  sum(goals_conceded)::int as goals_conceded
from public.player_tournament_stats
group by player_id;

grant select on public.player_tournament_stats to anon, authenticated;
grant select on public.player_stats            to anon, authenticated;
