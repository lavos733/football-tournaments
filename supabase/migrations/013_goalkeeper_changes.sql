-- Замены вратаря по ходу матча.
-- match_goalkeepers — кто стоял в воротах с начала матча; match_gk_changes — кто и когда встал в ворота потом.
-- Время замены (match_second) фиксирует приложение судьи в момент нажатия кнопки, как у голов (см. 012).
-- Пропущенный гол засчитывается тому вратарю, кто стоял в воротах в момент гола.
-- Сухой матч — вратарю, который не пропустил за свой отрезок и простоял не меньше половины матча.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–012)

create table if not exists public.match_gk_changes (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references public.matches on delete cascade,
  team_id       uuid not null references public.tournament_teams on delete cascade,
  player_id     uuid not null references public.players on delete restrict,
  match_second  integer check (match_second >= 0),
  created_at    timestamptz not null default now()
);
create index if not exists match_gk_changes_match_idx on public.match_gk_changes (match_id, created_at);

alter table public.match_gk_changes enable row level security;
drop policy if exists "read" on public.match_gk_changes;
create policy "read" on public.match_gk_changes for select using (true);
drop policy if exists "edit" on public.match_gk_changes;
create policy "edit" on public.match_gk_changes for all to authenticated
  using (public.can_edit_match(match_id)) with check (public.can_edit_match(match_id));

-- вратарь (стартовый или вышедший на замену) — игрок своей команды
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
  if tg_table_name in ('match_goalkeepers', 'match_gk_changes') then
    if v_team <> (to_jsonb(new) ->> 'team_id')::uuid then
      raise exception 'Вратарь должен быть из своей команды';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists match_gk_changes_validate on public.match_gk_changes;
create trigger match_gk_changes_validate
  before insert or update on public.match_gk_changes
  for each row execute function public.validate_match_player();

-- время замены: то же правило, что у событий (не позже текущего момента матча)
drop trigger if exists match_gk_changes_time on public.match_gk_changes;
create trigger match_gk_changes_time
  before insert on public.match_gk_changes
  for each row execute function public.set_match_event_time();

-- «Отменить начало» сбрасывает и замены вратаря
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
    delete from match_gk_changes where match_id = p_match;
    update matches set status = 'scheduled', home_score = null, away_score = null, timer_left = null, timer_since = null
    where id = p_match;
  else
    if p_status = 'live' and m.status = 'scheduled' then
      update matches set status = 'live',
        timer_left = (select match_minutes * 60 from tournaments where id = m.tournament_id),
        timer_since = now()
      where id = p_match;
    elsif p_status = 'finished' then
      update matches set status = 'finished', timer_left = public.match_timer_left(m), timer_since = null where id = p_match;
    else
      update matches set status = p_status where id = p_match;
    end if;
    perform public.recalc_match_score(p_match);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Статистика: вратарская часть считается по отрезкам «кто стоял в воротах»
-- (столбцы те же, поэтому player_stats пересоздавать не нужно)
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
-- отрезки: стартовый вратарь с 0-й секунды, дальше — каждая замена
spell_starts as (
  select g.match_id, g.team_id, g.player_id, 0 as start_sec, '-infinity'::timestamptz as start_at
  from match_goalkeepers g
  union all
  select c.match_id, c.team_id, c.player_id, c.match_second, c.created_at
  from match_gk_changes c
),
spells as (
  select s.*,
    lead(s.start_at)  over w as end_at,
    lead(s.start_sec) over w as end_sec
  from spell_starts s
  window w as (partition by s.match_id, s.team_id order by s.start_at)
),
-- длительность завершённого матча: длительность по турниру минус остаток таймера
fm as (
  select m.*, case when m.timer_left is null then null else t.match_minutes * 60 - m.timer_left end as len
  from matches m join tournaments t on t.id = m.tournament_id
  where m.status = 'finished'
),
spell_stats as (
  select fm.tournament_id, sp.match_id, sp.player_id, fm.len,
    case when fm.len is null or sp.start_sec is null or (sp.end_at is not null and sp.end_sec is null) then null
         else greatest(0, coalesce(sp.end_sec, fm.len) - sp.start_sec) end as secs,
    (select count(*) from match_events e
      where e.match_id = sp.match_id and e.type in ('goal', 'own_goal') and e.team_id <> sp.team_id
        and case
          -- по времени матча, если оно известно и у гола, и у отрезка
          when e.match_second is not null and sp.start_sec is not null and (sp.end_at is null or sp.end_sec is not null)
            then e.match_second >= sp.start_sec and (sp.end_at is null or e.match_second < sp.end_sec)
          -- иначе — по моменту записи
          else e.created_at >= sp.start_at and (sp.end_at is null or e.created_at < sp.end_at)
        end) as conceded
  from spells sp join fm on fm.id = sp.match_id
),
gk_match as (
  select tournament_id, match_id, player_id,
    sum(conceded) as conceded,
    case when bool_or(secs is null) or max(len) is null or max(len) <= 0 then null
         else sum(secs)::numeric / max(len) end as share
  from spell_stats group by 1, 2, 3
),
gk as (
  select tournament_id, player_id,
    count(*) as gk_matches,
    count(*) filter (where conceded = 0 and coalesce(share, 1) >= 0.5) as clean_sheets,
    coalesce(sum(conceded), 0) as goals_conceded
  from gk_match group by 1, 2
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
