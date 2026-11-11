-- Средний рейтинг (OVR) команды на момент старта турнира.
-- Рейтинг считается в приложении, поэтому при старте турнира оно передаёт средние значения по командам,
-- а start_tournament их сохраняет. До старта приложение показывает средний рейтинг по текущему составу.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–013)

alter table public.tournament_teams add column if not exists avg_rating numeric(4, 1);

-- p_ratings: {"<id команды турнира>": 67.4, ...}; без него турнир стартует, рейтинг не фиксируется
drop function if exists public.start_tournament(uuid);
create or replace function public.start_tournament(p_tournament uuid, p_ratings jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_editor(p_tournament) then raise exception 'Только организатор или судья'; end if;
  if public.tournament_status(p_tournament) <> 'draft' then raise exception 'Турнир уже запущен'; end if;
  if not exists (select 1 from matches where tournament_id = p_tournament) then
    raise exception 'Сначала составьте расписание';
  end if;
  if p_ratings is not null then
    update tournament_teams tt
      set avg_rating = round((p_ratings ->> tt.id::text)::numeric, 1)
      where tt.tournament_id = p_tournament and p_ratings ? tt.id::text;
  end if;
  update tournaments set status = 'active' where id = p_tournament;
end $$;
grant execute on function public.start_tournament(uuid, jsonb) to authenticated;

-- Прошедшие турниры: рейтинги, посчитанные по текущим данным (10.11.2026)
update public.tournament_teams set avg_rating = 73.7 where id = 'f68f52a5-c2be-4204-b7fd-630a7696ab60'; -- Чемпион двора 25.10, Жёлтые
update public.tournament_teams set avg_rating = 62.6 where id = 'c3f97856-635a-47d1-92da-e4447a34e20b'; -- Чемпион двора 25.10, Красные
update public.tournament_teams set avg_rating = 63.2 where id = '6daa043e-923d-48d7-bd18-4e8f95ceb27b'; -- Чемпион двора 25.10, Синие
update public.tournament_teams set avg_rating = 67.2 where id = '8e202f87-0fb4-4367-8392-bfa398977fd6'; -- Чемпион двора 1.11, Желтые
update public.tournament_teams set avg_rating = 65.7 where id = '297a431b-f55b-427b-ac82-fecb134dbbfa'; -- Чемпион двора 1.11, Синие
update public.tournament_teams set avg_rating = 66.5 where id = '781b1eb5-0e9e-4917-baed-0bf1692bb523'; -- Чемпион двора 1.11, Крас
update public.tournament_teams set avg_rating = 68.1 where id = 'ffeecf17-007f-4cbd-a198-08fe197ba60d'; -- Чемпион двора 08.11, Жёлтые
update public.tournament_teams set avg_rating = 67.9 where id = 'd3f417d6-0d61-49c9-8bb6-f268f72f28f1'; -- Чемпион двора 08.11, Синие
update public.tournament_teams set avg_rating = 64.4 where id = 'e4553659-c80c-4356-8832-094a481a01a0'; -- Чемпион двора 08.11, Красные
