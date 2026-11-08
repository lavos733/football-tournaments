-- Новая позиция «Универсал» (UNI): играет и в поле, и в воротах. Нужна для рейтинга игроков.
-- Вставить целиком в Supabase → SQL Editor → Run (после 001–009)

alter table public.players drop constraint if exists players_position_check;
alter table public.players add constraint players_position_check
  check (position in ('GK', 'DEF', 'MID', 'FWD', 'UNI'));
