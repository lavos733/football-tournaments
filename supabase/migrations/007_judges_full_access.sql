drop policy if exists "manage" on public.tournament_teams;

-- Судьи турнира получают те же права, что и организатор: команды, заявки, расписание,
-- старт/завершение, настройки, лучший игрок. Только организатор: удалить турнир и назначать судей.
-- Вставить целиком в Supabase → SQL Editor → Run

-- команды турнира — до старта
create policy "manage" on public.tournament_teams for all to authenticated
  using (public.is_tournament_editor(tournament_id) and public.tournament_status(tournament_id) = 'draft')
  with check (public.is_tournament_editor(tournament_id) and public.tournament_status(tournament_id) = 'draft');

-- заявки — пока турнир не завершён
drop policy if exists "manage" on public.roster_entries;
create policy "manage" on public.roster_entries for all to authenticated
  using (public.is_tournament_editor(tournament_id) and public.tournament_status(tournament_id) <> 'finished')
  with check (public.is_tournament_editor(tournament_id) and public.tournament_status(tournament_id) <> 'finished');

-- сброс расписания — до старта
drop policy if exists "delete" on public.matches;
create policy "delete" on public.matches for delete to authenticated
  using (public.is_tournament_editor(tournament_id) and public.tournament_status(tournament_id) = 'draft');

-- настройки турнира и лучший игрок (удаление по-прежнему только у организатора)
drop policy if exists "update" on public.tournaments;
create policy "update" on public.tournaments for update to authenticated
  using (public.is_tournament_editor(id));

-- расписание
create or replace function public.generate_schedule(p_tournament uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  t         tournaments;
  v_min     int;
  v_max     int;
  v_bad     record;
  v_ids     uuid[];
  v_arr     uuid[];
  v_n       int;
  k         int;
  r         int;
  i         int;
  a         uuid;
  b         uuid;
  h         uuid;
  aw        uuid;
  v_ord     int;
  v_count   int := 0;
begin
  select * into t from tournaments where id = p_tournament;
  if not found then raise exception 'Турнир не найден'; end if;
  if not public.is_tournament_editor(p_tournament) then raise exception 'Расписание составляют организатор и судьи'; end if;
  if t.status <> 'draft' then raise exception 'Расписание можно менять только до старта турнира'; end if;

  v_min := t.format;
  v_max := case t.format when 5 then 10 else 14 end;

  select array_agg(id order by seed nulls last, created_at) into v_ids
  from tournament_teams where tournament_id = p_tournament;

  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception 'Нужно минимум 2 команды'; end if;

  for v_bad in
    select tt.name, count(re.id) as cnt
    from tournament_teams tt
    left join roster_entries re on re.tournament_team_id = tt.id
    where tt.tournament_id = p_tournament
    group by tt.id, tt.name
    having count(re.id) < v_min or count(re.id) > v_max
  loop
    raise exception 'В команде «%» % игроков, нужно от % до %', v_bad.name, v_bad.cnt, v_min, v_max;
  end loop;

  delete from matches where tournament_id = p_tournament;

  v_n := array_length(v_ids, 1);
  if v_n % 2 = 1 then v_n := v_n + 1; end if;   -- при нечётном числе одна команда отдыхает

  for k in 1..t.rounds loop
    v_arr := v_ids;
    if array_length(v_arr, 1) < v_n then v_arr := array_append(v_arr, null::uuid); end if;

    for r in 0..v_n - 2 loop
      v_ord := 0;
      for i in 0..v_n / 2 - 1 loop
        a := v_arr[i + 1];
        b := v_arr[v_n - i];
        continue when a is null or b is null;

        if i = 0 and r % 2 = 1 then h := b; aw := a; else h := a; aw := b; end if;
        if k % 2 = 0 then  -- во втором круге хозяева и гости меняются
          a := h; h := aw; aw := a;
        end if;

        v_ord := v_ord + 1;
        insert into matches (tournament_id, circle, matchday, position, home_team_id, away_team_id)
        values (p_tournament, k, (k - 1) * (v_n - 1) + r + 1, v_ord, h, aw);
        v_count := v_count + 1;
      end loop;

      -- поворот: первая команда на месте, последняя встаёт второй
      v_arr := array[v_arr[1], v_arr[v_n]] || v_arr[2:v_n - 1];
    end loop;
  end loop;

  return v_count;
end $$;

create or replace function public.start_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_editor(p_tournament) then raise exception 'Только организатор или судья'; end if;
  if public.tournament_status(p_tournament) <> 'draft' then raise exception 'Турнир уже запущен'; end if;
  if not exists (select 1 from matches where tournament_id = p_tournament) then
    raise exception 'Сначала составьте расписание';
  end if;
  update tournaments set status = 'active' where id = p_tournament;
end $$;

create or replace function public.reset_tournament_to_draft(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_editor(p_tournament) then raise exception 'Только организатор или судья'; end if;
  if exists (select 1 from matches where tournament_id = p_tournament and status <> 'scheduled') then
    raise exception 'Уже есть сыгранные матчи — вернуть в черновик нельзя';
  end if;
  update tournaments set status = 'draft' where id = p_tournament;
end $$;

create or replace function public.finish_tournament(p_tournament uuid, p_winner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_editor(p_tournament) then raise exception 'Только организатор или судья'; end if;
  if public.tournament_status(p_tournament) <> 'active' then raise exception 'Турнир не идёт'; end if;
  if exists (select 1 from matches where tournament_id = p_tournament and status <> 'finished') then
    raise exception 'Сначала завершите все матчи';
  end if;
  if not exists (select 1 from tournament_teams where id = p_winner and tournament_id = p_tournament) then
    raise exception 'Победитель должен быть командой этого турнира';
  end if;
  update tournaments set status = 'finished', winner_team_id = p_winner where id = p_tournament;
end $$;

create or replace function public.reopen_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_editor(p_tournament) then raise exception 'Только организатор или судья'; end if;
  if public.tournament_status(p_tournament) <> 'finished' then raise exception 'Турнир не завершён'; end if;
  update tournaments set status = 'active', winner_team_id = null where id = p_tournament;
end $$;
