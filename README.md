# Турниры — Telegram Mini App

Товарищеские футбольные турниры: общая база игроков и команд, турниры 5×5 / 8×8, круговое расписание.

## Стек
- React + TypeScript + Vite (фронтенд)
- Supabase: Postgres + права доступа (RLS) + хранилище фото
- Позже: Vercel (хостинг) и бот в Telegram

## Подключение Supabase (один раз)
1. https://supabase.com → **New project** (бесплатный план). Регион — ближайший (например, Frankfurt).
2. **SQL Editor → New query** → вставить весь файл `supabase/migrations/001_init.sql` → **Run**.
3. **Authentication → Sign In / Providers** → включить **Allow anonymous sign-ins**.
4. **Project Settings → API**: скопировать **Project URL** и **anon public** ключ.
5. Создать файл `.env` рядом с `package.json`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```

## Запуск
```
npm install
npm run dev
```
Открыть http://localhost:5173

## Выкладка
- Приложение: https://lavos733.github.io/football-tournaments/ (GitHub Pages, ветка `gh-pages`)
- Обновить сайт: `npm run deploy`
- Код: https://github.com/lavos733/football-tournaments
- Vercel (`npm run deploy:vercel`) остался запасным вариантом — в России `*.vercel.app` блокируется
- Обновить функцию входа: `npm run deploy:auth`
- Секрет бота: Supabase → Edge Functions → Secrets → `TELEGRAM_BOT_TOKEN`

## Перенос данных со старого профиля
В приложении: Профиль → «ID профиля» (старый — в браузере на localhost, новый — в Telegram).
Затем в SQL Editor: `select public.merge_profiles('старый ID', 'новый ID');`

## Этапы
1. ✅ Игроки, команды, турнир, заявки, расписание
2. Ввод счёта и событий матча, таблица, бомбардиры/ассистенты, судьи
3. Статистика игрока за всё время
4. Бот, вход через Telegram, деплой
5. Новые показатели, плей-офф
