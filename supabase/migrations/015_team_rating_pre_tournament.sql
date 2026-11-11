-- Средний рейтинг команд на старте прошедших турниров — по истории ДО каждого турнира,
-- посчитанный текущей формулой рейтинга. Заменяет значения из 014, которые были посчитаны
-- по рейтингам после всех сыгранных турниров. Кто ещё не играл — стартовые 65,
-- поэтому в первом турнире (25.10) у всех команд по 65.
-- Вставить целиком в Supabase → SQL Editor → Run (после 014)

update public.tournament_teams set avg_rating = 65.0 where id = 'f68f52a5-c2be-4204-b7fd-630a7696ab60'; -- 25.10, Жёлтые (было 73.7)
update public.tournament_teams set avg_rating = 65.0 where id = 'c3f97856-635a-47d1-92da-e4447a34e20b'; -- 25.10, Красные (было 62.6)
update public.tournament_teams set avg_rating = 65.0 where id = '6daa043e-923d-48d7-bd18-4e8f95ceb27b'; -- 25.10, Синие (было 63.2)
update public.tournament_teams set avg_rating = 65.0 where id = '8e202f87-0fb4-4367-8392-bfa398977fd6'; -- 1.11, Желтые (было 67.2)
update public.tournament_teams set avg_rating = 67.4 where id = '297a431b-f55b-427b-ac82-fecb134dbbfa'; -- 1.11, Синие (было 65.7)
update public.tournament_teams set avg_rating = 65.2 where id = '781b1eb5-0e9e-4917-baed-0bf1692bb523'; -- 1.11, Крас (было 66.5)
update public.tournament_teams set avg_rating = 68.5 where id = 'ffeecf17-007f-4cbd-a198-08fe197ba60d'; -- 08.11, Жёлтые (было 68.1)
update public.tournament_teams set avg_rating = 66.0 where id = 'd3f417d6-0d61-49c9-8bb6-f268f72f28f1'; -- 08.11, Синие (было 67.9)
update public.tournament_teams set avg_rating = 64.4 where id = 'e4553659-c80c-4356-8832-094a481a01a0'; -- 08.11, Красные (было 64.4)
