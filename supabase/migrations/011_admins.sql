-- Администраторы: правят любого игрока и рассматривают все заявки «Это я».
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–010)

alter table public.profiles add column if not exists is_admin boolean not null default false;
-- флаг меняется только здесь, из SQL: самому себе его не выставить (update разрешён лишь для display_name)

-- Егор Ладиков
update public.profiles set is_admin = true where id = '26f6031a-b88c-434c-a7fa-91032689dc5a';

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;
grant execute on function public.is_admin() to authenticated;

-- игроки: правит создатель, привязанный человек или администратор
drop policy if exists "update" on public.players;
create policy "update" on public.players for update to authenticated
  using (created_by = (select auth.uid()) or linked_profile_id = (select auth.uid()) or (select public.is_admin()));

-- заявки «Это я»: решает создатель игрока или администратор
create or replace function public.decide_player_claim(p_claim uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_claim player_claims;
  v_player players;
begin
  select * into v_claim from player_claims where id = p_claim and status = 'pending';
  if not found then raise exception 'Заявка не найдена или уже рассмотрена'; end if;
  select * into v_player from players where id = v_claim.player_id;
  if v_player.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Подтвердить может только создатель игрока или администратор';
  end if;

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
