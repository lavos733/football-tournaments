-- Награды по итогам турнира:
--   «Волчья малина» — худший игрок турнира (−0,5 к рейтингу)
--   «Премия Пушкаша» — лучший (самый красивый) гол турнира (+0,5 к рейтингу автору гола)
-- Обе необязательны: null — не выдаётся.
-- Вставить целиком в Supabase → SQL Editor → Run

alter table public.tournaments
  add column if not exists worst_player_id    uuid references public.players      on delete set null,
  add column if not exists best_goal_event_id uuid references public.match_events on delete set null;

grant update (worst_player_id, best_goal_event_id) on public.tournaments to authenticated;

create or replace function public.validate_tournament_awards()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.worst_player_id is not null and new.worst_player_id is distinct from old.worst_player_id
     and not exists (select 1 from roster_entries where tournament_id = new.id and player_id = new.worst_player_id) then
    raise exception '«Волчья малина»: игрок должен быть заявлен в этом турнире';
  end if;
  if new.best_goal_event_id is not null and new.best_goal_event_id is distinct from old.best_goal_event_id
     and not exists (
       select 1 from match_events e join matches m on m.id = e.match_id
       where e.id = new.best_goal_event_id and m.tournament_id = new.id and e.type = 'goal' and e.player_id is not null
     ) then
    raise exception '«Премия Пушкаша»: нужен гол этого турнира с автором';
  end if;
  return new;
end $$;

drop trigger if exists tournaments_validate_awards on public.tournaments;
create trigger tournaments_validate_awards
  before update on public.tournaments
  for each row execute function public.validate_tournament_awards();
