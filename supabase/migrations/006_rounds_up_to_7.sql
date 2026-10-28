alter table public.tournaments drop constraint if exists tournaments_rounds_check;
alter table public.tournaments add constraint tournaments_rounds_check check (rounds between 1 and 7);
-- Максимум кругов в турнире: 7 (было 4)
