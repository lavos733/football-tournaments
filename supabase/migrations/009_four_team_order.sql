-- Расписание для 4 команд — в заранее заданном честном порядке (без длинных серий игр и отдыха подряд).
-- Остальные составы — по-прежнему круговой алгоритм. Уже составленные расписания не меняются:
-- чтобы применить порядок к черновику, составьте расписание заново.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–008)

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
  -- порядок для 4 команд: номер команды хозяев/гостей по матчам двух кругов подряд
  v_home    int[] := array[1, 2, 3, 4, 1, 3,  4, 3, 2, 1, 4, 2];
  v_away    int[] := array[3, 4, 2, 1, 2, 4,  2, 1, 3, 4, 3, 1];
  v_idx     int;
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

  -- 4 команды — фиксированный порядок: никто не играет больше двух матчей подряд и не отдыхает дольше двух.
  -- Нечётные круги — матчи 1–6, чётные — 7–12 (те же пары, хозяева и гости поменялись).
  if array_length(v_ids, 1) = 4 then
    for k in 1..t.rounds loop
      for r in 0..2 loop
        for i in 1..2 loop
          v_idx := case when k % 2 = 1 then 0 else 6 end + r * 2 + i;
          insert into matches (tournament_id, circle, matchday, position, home_team_id, away_team_id)
          values (p_tournament, k, (k - 1) * 3 + r + 1, i, v_ids[v_home[v_idx]], v_ids[v_away[v_idx]]);
          v_count := v_count + 1;
        end loop;
      end loop;
    end loop;
    return v_count;
  end if;

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
