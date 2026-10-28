-- Исправление: отметка «не играл» падала с ошибкой record "new" has no field "team_id"
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
