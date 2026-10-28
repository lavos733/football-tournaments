create or replace function public.merge_profiles(p_from uuid, p_to uuid)
returns text language plpgsql security definer set search_path = public as $$
-- Перенос всех данных одного профиля на другой (например, тестовый профиль браузера → профиль Telegram).
-- Запуск только вручную из Supabase → SQL Editor:
--   select public.merge_profiles('ID старого профиля', 'ID нового профиля');
-- ID видны в приложении: Профиль → «ID профиля». Старый профиль после переноса удаляется.
begin
  if p_from = p_to then raise exception 'Это один и тот же профиль'; end if;
  if not exists (select 1 from profiles where id = p_from) then raise exception 'Старый профиль не найден'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'Новый профиль не найден'; end if;

  update players set created_by = p_to where created_by = p_from;
  if exists (select 1 from players where linked_profile_id = p_to) then
    update players set linked_profile_id = null where linked_profile_id = p_from;
  else
    update players set linked_profile_id = p_to where linked_profile_id = p_from;
  end if;

  delete from player_claims c where c.profile_id = p_from
    and exists (select 1 from player_claims d where d.profile_id = p_to and d.player_id = c.player_id and d.status = 'pending');
  update player_claims set profile_id = p_to where profile_id = p_from;

  update teams       set created_by = p_to where created_by = p_from;
  update tournaments set created_by = p_to where created_by = p_from;
  update series      set created_by = p_to where created_by = p_from;
  update match_events set created_by = p_to where created_by = p_from;

  delete from tournament_judges j where j.profile_id = p_from
    and exists (select 1 from tournament_judges k where k.tournament_id = j.tournament_id and k.profile_id = p_to);
  update tournament_judges set profile_id = p_to where profile_id = p_from;
  -- организатор не может быть судьёй своего же турнира
  delete from tournament_judges j using tournaments t where j.tournament_id = t.id and j.profile_id = t.created_by;

  delete from auth.users where id = p_from;
  return 'Готово: данные перенесены, старый профиль удалён';
end $$;

-- только из SQL Editor (под администратором), из приложения вызвать нельзя
revoke execute on function public.merge_profiles(uuid, uuid) from public, anon, authenticated;
