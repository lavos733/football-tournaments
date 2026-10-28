alter table public.matches add column if not exists mvp_player_id uuid references public.players on delete set null;

-- Этап 2: события матча, вратари, кто не играл, лучший игрок, статистика.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001_init.sql)

-- ---------------------------------------------------------------------
-- События матча
--   goal      — гол; team_id — кому засчитан; player_id может быть пустым (автор неизвестен)
--   own_goal  — автогол; team_id — кому засчитан; player_id — игрок соперника
--   yellow/red — карточки; team_id — команда игрока
-- ---------------------------------------------------------------------
create table public.match_events (
  id                uuid primary key default gen_random_uuid(),
  match_id          uuid not null references public.matches on delete cascade,
  type              text not null check (type in ('goal', 'own_goal', 'yellow', 'red')),
  team_id           uuid not null references public.tournament_teams on delete cascade,
  player_id         uuid references public.players on delete restrict,
  assist_player_id  uuid references public.players on delete restrict,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid() references public.profiles on delete set null,
  check (type = 'goal' or player_id is not null),
  check (assist_player_id is null or (type = 'goal' and assist_player_id is distinct from player_id))
);
create index match_events_match_idx on public.match_events (match_id, created_at);

-- Основной вратарь команды в матче
create table public.match_goalkeepers (
  match_id   uuid not null references public.matches on delete cascade,
  team_id    uuid not null references public.tournament_teams on delete cascade,
  player_id  uuid not null references public.players on delete restrict,
  primary key (match_id, team_id)
);

-- По умолчанию весь состав сыграл матч; здесь отмечаются те, кто НЕ играл
create table public.match_absences (
  match_id   uuid not null references public.matches on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  primary key (match_id, player_id)
);

-- ---------------------------------------------------------------------
-- Вспомогательные функции
-- ---------------------------------------------------------------------
-- Матч можно редактировать организатору и судьям, пока турнир идёт
create or replace function public.can_edit_match(p_match uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches m join tournaments t on t.id = m.tournament_id
    where m.id = p_match and t.status = 'active' and public.is_tournament_editor(t.id)
  );
$$;

-- За какую команду турнира заявлен игрок (в рамках турнира этого матча)
create or replace function public.player_team_in_match(p_match uuid, p_player uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select re.tournament_team_id
  from matches m join roster_entries re on re.tournament_id = m.tournament_id and re.player_id = p_player
  where m.id = p_match;
$$;

-- ---------------------------------------------------------------------
-- Проверки событий и автоматический счёт
-- ---------------------------------------------------------------------
create or replace function public.validate_match_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m        matches;
  v_other  uuid;
begin
  select * into m from matches where id = new.match_id;
  if m.status = 'scheduled' then raise exception 'Сначала начните матч'; end if;
  if new.team_id not in (m.home_team_id, m.away_team_id) then raise exception 'Эта команда не играет в матче'; end if;
  v_other := case when new.team_id = m.home_team_id then m.away_team_id else m.home_team_id end;

  if new.player_id is not null then
    if new.type = 'own_goal' then
      if public.player_team_in_match(new.match_id, new.player_id) is distinct from v_other then
        raise exception 'Автогол забивает игрок команды соперника';
      end if;
    elsif public.player_team_in_match(new.match_id, new.player_id) is distinct from new.team_id then
      raise exception 'Игрок не заявлен за эту команду';
    end if;
  end if;

  if new.assist_player_id is not null
     and public.player_team_in_match(new.match_id, new.assist_player_id) is distinct from new.team_id then
    raise exception 'Ассистент должен быть из той же команды';
  end if;
  return new;
end $$;

create trigger match_events_validate
  before insert or update on public.match_events
  for each row execute function public.validate_match_event();

-- Счёт = число голов (включая автоголы) по событиям
create or replace function public.recalc_match_score(p_match uuid)
returns void language sql security definer set search_path = public as $$
  update matches m set
    home_score = (select count(*) from match_events e where e.match_id = m.id and e.type in ('goal', 'own_goal') and e.team_id = m.home_team_id),
    away_score = (select count(*) from match_events e where e.match_id = m.id and e.type in ('goal', 'own_goal') and e.team_id = m.away_team_id)
  where m.id = p_match and m.status <> 'scheduled';
$$;

create or replace function public.match_events_recalc()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalc_match_score(coalesce(new.match_id, old.match_id));
  return null;
end $$;

create trigger match_events_score
  after insert or update or delete on public.match_events
  for each row execute function public.match_events_recalc();

-- Вратарь и «не играл» — только игроки команд этого матча
create or replace function public.validate_match_player()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  m       matches;
  v_team  uuid;
begin
  select * into m from matches where id = new.match_id;
  v_team := public.player_team_in_match(new.match_id, new.player_id);
  if v_team is null or v_team not in (m.home_team_id, m.away_team_id) then
    raise exception 'Игрок не заявлен ни за одну из команд матча';
  end if;
  if tg_table_name = 'match_goalkeepers' then
    if v_team <> (to_jsonb(new) ->> 'team_id')::uuid then
      raise exception 'Вратарь должен быть из своей команды';
    end if;
  end if;
  return new;
end $$;

create trigger match_goalkeepers_validate
  before insert or update on public.match_goalkeepers
  for each row execute function public.validate_match_player();
create trigger match_absences_validate
  before insert or update on public.match_absences
  for each row execute function public.validate_match_player();

-- Лучший игрок матча — из команд этого матча
create or replace function public.validate_match_mvp()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_team uuid;
begin
  if new.mvp_player_id is not null and new.mvp_player_id is distinct from old.mvp_player_id then
    v_team := public.player_team_in_match(new.id, new.mvp_player_id);
    if v_team is null or v_team not in (new.home_team_id, new.away_team_id) then
      raise exception 'Лучший игрок должен быть из команд этого матча';
    end if;
  end if;
  return new;
end $$;

create trigger matches_validate_mvp
  before update on public.matches
  for each row execute function public.validate_match_mvp();

-- Статус матча: scheduled → live → finished (и обратно для исправлений)
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
    update matches set status = 'scheduled', home_score = null, away_score = null, mvp_player_id = null where id = p_match;
  else
    update matches set status = p_status where id = p_match;
    perform public.recalc_match_score(p_match);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Завершение турнира
-- ---------------------------------------------------------------------
create or replace function public.finish_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if public.tournament_status(p_tournament) <> 'active' then raise exception 'Турнир не идёт'; end if;
  if exists (select 1 from matches where tournament_id = p_tournament and status <> 'finished') then
    raise exception 'Сначала завершите все матчи';
  end if;
  update tournaments set status = 'finished' where id = p_tournament;
end $$;

create or replace function public.reopen_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if public.tournament_status(p_tournament) <> 'finished' then raise exception 'Турнир не завершён'; end if;
  update tournaments set status = 'active' where id = p_tournament;
end $$;

-- ---------------------------------------------------------------------
-- Права доступа
-- ---------------------------------------------------------------------
alter table public.match_events      enable row level security;
alter table public.match_goalkeepers enable row level security;
alter table public.match_absences    enable row level security;

create policy "read" on public.match_events      for select using (true);
create policy "read" on public.match_goalkeepers for select using (true);
create policy "read" on public.match_absences    for select using (true);

create policy "edit" on public.match_events for all to authenticated
  using (public.can_edit_match(match_id)) with check (public.can_edit_match(match_id));
create policy "edit" on public.match_goalkeepers for all to authenticated
  using (public.can_edit_match(match_id)) with check (public.can_edit_match(match_id));
create policy "edit" on public.match_absences for all to authenticated
  using (public.can_edit_match(match_id)) with check (public.can_edit_match(match_id));

-- Матч: напрямую можно менять только лучшего игрока; счёт считается сам, статус — через set_match_status
drop policy if exists "update" on public.matches;
create policy "update" on public.matches for update to authenticated
  using (public.can_edit_match(id));
revoke update on public.matches from anon, authenticated;
grant update (mvp_player_id) on public.matches to authenticated;

grant execute on function public.set_match_status(uuid, text)   to authenticated;
grant execute on function public.finish_tournament(uuid)        to authenticated;
grant execute on function public.reopen_tournament(uuid)        to authenticated;

-- ---------------------------------------------------------------------
-- Статистика игроков (считается из событий — отдельно не хранится)
-- Матчи и победы — по завершённым матчам; голы/ассисты/карточки — и по идущим.
-- ---------------------------------------------------------------------
create or replace view public.player_tournament_stats with (security_invoker = on) as
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
mvp as (
  select tournament_id, mvp_player_id as player_id, count(*) as mvp
  from matches where mvp_player_id is not null and status = 'finished'
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
  coalesce(mvp.mvp, 0)::int           as mvp,
  coalesce(gk.gk_matches, 0)::int     as gk_matches,
  coalesce(gk.clean_sheets, 0)::int   as clean_sheets,
  coalesce(gk.goals_conceded, 0)::int as goals_conceded
from roster_entries re
join tournaments t on t.id = re.tournament_id
left join app_agg a on a.tournament_id = re.tournament_id and a.player_id = re.player_id
left join ev        on ev.tournament_id = re.tournament_id and ev.player_id = re.player_id
left join ast       on ast.tournament_id = re.tournament_id and ast.player_id = re.player_id
left join mvp       on mvp.tournament_id = re.tournament_id and mvp.player_id = re.player_id
left join gk        on gk.tournament_id = re.tournament_id and gk.player_id = re.player_id;

-- За всё время
create or replace view public.player_stats with (security_invoker = on) as
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
  sum(mvp)::int            as mvp,
  sum(gk_matches)::int     as gk_matches,
  sum(clean_sheets)::int   as clean_sheets,
  sum(goals_conceded)::int as goals_conceded
from public.player_tournament_stats
group by player_id;

grant select on public.player_tournament_stats to anon, authenticated;
grant select on public.player_stats            to anon, authenticated;
