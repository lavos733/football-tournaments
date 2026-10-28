create extension if not exists pgcrypto;

-- Футбольные турниры — этап 1: игроки, команды, турниры, расписание.
-- Вставить целиком в Supabase → SQL Editor → Run

-- ---------------------------------------------------------------------
-- Профили пользователей (1:1 с auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null default 'Без имени',
  telegram_id   bigint unique,
  username      text,
  created_at    timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'Без имени'));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Игроки (общая база)
-- ---------------------------------------------------------------------
create table public.players (
  id                 uuid primary key default gen_random_uuid(),
  first_name         text not null check (length(trim(first_name)) > 0),
  last_name          text not null default '',
  photo_url          text,
  position           text check (position in ('GK', 'DEF', 'MID', 'FWD')),
  birth_date         date,
  created_by         uuid not null default auth.uid() references public.profiles on delete restrict,
  linked_profile_id  uuid unique references public.profiles on delete set null,
  created_at         timestamptz not null default now()
);
create index players_name_idx on public.players (lower(last_name), lower(first_name));

-- Заявки «Это я»
create table public.player_claims (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players on delete cascade,
  profile_id  uuid not null default auth.uid() references public.profiles on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
create unique index player_claims_one_pending
  on public.player_claims (player_id, profile_id) where status = 'pending';

-- ---------------------------------------------------------------------
-- Команды (общая база) и их обычный состав
-- ---------------------------------------------------------------------
create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  color       text not null default '#2f80ed',
  logo_url    text,
  created_by  uuid not null default auth.uid() references public.profiles on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.team_players (
  team_id    uuid not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  primary key (team_id, player_id)
);

-- ---------------------------------------------------------------------
-- Турниры
-- ---------------------------------------------------------------------
create table public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  format      smallint not null check (format in (5, 8)),
  rounds      smallint not null default 1 check (rounds between 1 and 7),
  status      text not null default 'draft' check (status in ('draft', 'active', 'finished')),
  created_by  uuid not null default auth.uid() references public.profiles on delete restrict,
  created_at  timestamptz not null default now()
);

create table public.tournament_judges (
  tournament_id  uuid not null references public.tournaments on delete cascade,
  profile_id     uuid not null references public.profiles on delete cascade,
  primary key (tournament_id, profile_id)
);

-- Команда внутри турнира (своё название; ссылка на базу — необязательна)
create table public.tournament_teams (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments on delete cascade,
  team_id        uuid references public.teams on delete set null,
  name           text not null check (length(trim(name)) > 0),
  color          text not null default '#2f80ed',
  seed           smallint,
  created_at     timestamptz not null default now(),
  unique (id, tournament_id),
  unique (tournament_id, name)
);

-- Состав команды на турнир. Номер живёт здесь — он может меняться от команды к команде.
create table public.roster_entries (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments on delete cascade,
  tournament_team_id  uuid not null,
  player_id           uuid not null references public.players on delete restrict,
  number              smallint check (number between 0 and 99),
  foreign key (tournament_team_id, tournament_id)
    references public.tournament_teams (id, tournament_id) on delete cascade,
  unique (tournament_id, player_id),          -- один игрок — одна команда в турнире
  unique (tournament_team_id, number)         -- номера в команде не повторяются
);

-- ---------------------------------------------------------------------
-- Матчи
-- ---------------------------------------------------------------------
create table public.matches (
  id             uuid primary key default gen_random_uuid(),
  tournament_id  uuid not null references public.tournaments on delete cascade,
  circle         smallint not null,      -- круг
  matchday       smallint not null,      -- тур (сквозная нумерация)
  position       smallint not null,      -- порядок матча внутри тура
  home_team_id   uuid not null references public.tournament_teams on delete cascade,
  away_team_id   uuid not null references public.tournament_teams on delete cascade,
  home_score     smallint check (home_score >= 0),
  away_score     smallint check (away_score >= 0),
  status         text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished')),
  check (home_team_id <> away_team_id)
);
create index matches_tournament_idx on public.matches (tournament_id, matchday, position);

-- ---------------------------------------------------------------------
-- Вспомогательные функции прав
-- ---------------------------------------------------------------------
create or replace function public.is_tournament_owner(p_tournament uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tournaments where id = p_tournament and created_by = auth.uid());
$$;

create or replace function public.is_tournament_editor(p_tournament uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_tournament_owner(p_tournament)
      or exists (select 1 from tournament_judges where tournament_id = p_tournament and profile_id = auth.uid());
$$;

create or replace function public.tournament_status(p_tournament uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from tournaments where id = p_tournament;
$$;

-- ---------------------------------------------------------------------
-- Права доступа (RLS): смотреть могут все, менять — владельцы
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.players           enable row level security;
alter table public.player_claims     enable row level security;
alter table public.teams             enable row level security;
alter table public.team_players      enable row level security;
alter table public.tournaments       enable row level security;
alter table public.tournament_judges enable row level security;
alter table public.tournament_teams  enable row level security;
alter table public.roster_entries    enable row level security;
alter table public.matches           enable row level security;

-- чтение — всем
create policy "read" on public.profiles          for select using (true);
create policy "read" on public.players           for select using (true);
create policy "read" on public.player_claims     for select using (true);
create policy "read" on public.teams             for select using (true);
create policy "read" on public.team_players      for select using (true);
create policy "read" on public.tournaments       for select using (true);
create policy "read" on public.tournament_judges for select using (true);
create policy "read" on public.tournament_teams  for select using (true);
create policy "read" on public.roster_entries    for select using (true);
create policy "read" on public.matches           for select using (true);

-- профиль: только свой
create policy "update own" on public.profiles for update to authenticated
  using (id = (select auth.uid()));

-- игроки: создаёт любой; правит создатель или привязанный человек; удаляет создатель
create policy "insert" on public.players for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "update" on public.players for update to authenticated
  using (created_by = (select auth.uid()) or linked_profile_id = (select auth.uid()));
create policy "delete" on public.players for delete to authenticated
  using (created_by = (select auth.uid()));

-- заявки «Это я»: отозвать свою ожидающую (создание и решение — через функции ниже)
create policy "delete own pending" on public.player_claims for delete to authenticated
  using (profile_id = (select auth.uid()) and status = 'pending');

-- команды
create policy "insert" on public.teams for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "update" on public.teams for update to authenticated
  using (created_by = (select auth.uid()));
create policy "delete" on public.teams for delete to authenticated
  using (created_by = (select auth.uid()));

create policy "manage" on public.team_players for all to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.created_by = (select auth.uid())))
  with check (exists (select 1 from public.teams t where t.id = team_id and t.created_by = (select auth.uid())));

-- турниры
create policy "insert" on public.tournaments for insert to authenticated
  with check (created_by = (select auth.uid()));
create policy "update" on public.tournaments for update to authenticated
  using (created_by = (select auth.uid()));
create policy "delete" on public.tournaments for delete to authenticated
  using (created_by = (select auth.uid()));

create policy "manage" on public.tournament_judges for all to authenticated
  using (public.is_tournament_owner(tournament_id))
  with check (public.is_tournament_owner(tournament_id));

-- команды турнира: только организатор и только до старта
create policy "manage" on public.tournament_teams for all to authenticated
  using (public.is_tournament_owner(tournament_id) and public.tournament_status(tournament_id) = 'draft')
  with check (public.is_tournament_owner(tournament_id) and public.tournament_status(tournament_id) = 'draft');

-- составы: организатор, пока турнир не завершён
create policy "manage" on public.roster_entries for all to authenticated
  using (public.is_tournament_owner(tournament_id) and public.tournament_status(tournament_id) <> 'finished')
  with check (public.is_tournament_owner(tournament_id) and public.tournament_status(tournament_id) <> 'finished');

-- матчи: создаются функцией generate_schedule; счёт правят организатор и судьи
create policy "update" on public.matches for update to authenticated
  using (public.is_tournament_editor(tournament_id));
-- сбросить расписание (например, после смены состава турнира) — организатор, до старта
create policy "delete" on public.matches for delete to authenticated
  using (public.is_tournament_owner(tournament_id) and public.tournament_status(tournament_id) = 'draft');

-- Защита служебных полей: менять можно только перечисленные колонки
revoke update on public.profiles    from anon, authenticated;
revoke update on public.players     from anon, authenticated;
revoke update on public.teams       from anon, authenticated;
revoke update on public.tournaments from anon, authenticated;
revoke update on public.matches     from anon, authenticated;
grant update (display_name)                                         on public.profiles    to authenticated;
grant update (first_name, last_name, photo_url, position, birth_date) on public.players   to authenticated;
grant update (name, color, logo_url)                                on public.teams       to authenticated;
grant update (name, format, rounds)                                 on public.tournaments to authenticated;
grant update (home_score, away_score, status)                       on public.matches     to authenticated;

-- ---------------------------------------------------------------------
-- «Это я»: заявка и подтверждение
-- ---------------------------------------------------------------------
create or replace function public.request_player_claim(p_player uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_player players;
begin
  if auth.uid() is null then raise exception 'Нужно войти'; end if;
  select * into v_player from players where id = p_player;
  if not found then raise exception 'Игрок не найден'; end if;
  if v_player.linked_profile_id is not null then raise exception 'Этот игрок уже привязан к профилю'; end if;
  if exists (select 1 from players where linked_profile_id = auth.uid()) then
    raise exception 'Ваш профиль уже привязан к другому игроку';
  end if;

  -- создатель игрока привязывает себя сразу
  if v_player.created_by = auth.uid() then
    update players set linked_profile_id = auth.uid() where id = p_player;
    return 'linked';
  end if;

  insert into player_claims (player_id, profile_id) values (p_player, auth.uid())
  on conflict do nothing;
  return 'pending';
end $$;

create or replace function public.decide_player_claim(p_claim uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_claim player_claims;
  v_player players;
begin
  select * into v_claim from player_claims where id = p_claim and status = 'pending';
  if not found then raise exception 'Заявка не найдена или уже рассмотрена'; end if;
  select * into v_player from players where id = v_claim.player_id;
  if v_player.created_by <> auth.uid() then raise exception 'Подтвердить может только создатель игрока'; end if;

  if p_approve then
    if v_player.linked_profile_id is not null then raise exception 'Игрок уже привязан'; end if;
    if exists (select 1 from players where linked_profile_id = v_claim.profile_id) then
      raise exception 'Этот человек уже привязан к другому игроку';
    end if;
    update players set linked_profile_id = v_claim.profile_id where id = v_player.id;
    update player_claims set status = 'approved', decided_at = now() where id = p_claim;
    update player_claims set status = 'rejected', decided_at = now()
      where player_id = v_player.id and status = 'pending';
  else
    update player_claims set status = 'rejected', decided_at = now() where id = p_claim;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Генерация расписания: круговая система (таблицы Бергера)
-- ---------------------------------------------------------------------
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
  if t.created_by <> auth.uid() then raise exception 'Расписание составляет только организатор'; end if;
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

-- Старт турнира: фиксирует команды и расписание
create or replace function public.start_tournament(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if public.tournament_status(p_tournament) <> 'draft' then raise exception 'Турнир уже запущен'; end if;
  if not exists (select 1 from matches where tournament_id = p_tournament) then
    raise exception 'Сначала составьте расписание';
  end if;
  update tournaments set status = 'active' where id = p_tournament;
end $$;

-- Возврат в черновик (если ни один матч ещё не сыгран)
create or replace function public.reset_tournament_to_draft(p_tournament uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_tournament_owner(p_tournament) then raise exception 'Только организатор'; end if;
  if exists (select 1 from matches where tournament_id = p_tournament and status <> 'scheduled') then
    raise exception 'Уже есть сыгранные матчи — вернуть в черновик нельзя';
  end if;
  update tournaments set status = 'draft' where id = p_tournament;
end $$;

grant execute on function public.request_player_claim(uuid)          to authenticated;
grant execute on function public.decide_player_claim(uuid, boolean)  to authenticated;
grant execute on function public.generate_schedule(uuid)             to authenticated;
grant execute on function public.start_tournament(uuid)              to authenticated;
grant execute on function public.reset_tournament_to_draft(uuid)     to authenticated;

-- ---------------------------------------------------------------------
-- Хранилище фото (игроки, эмблемы команд)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "photos read" on storage.objects for select
  using (bucket_id = 'photos');
create policy "photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos');
create policy "photos update own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid()::text));
create policy "photos delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and owner_id = (select auth.uid()::text));
