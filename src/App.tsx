import { useState, type FormEvent } from 'react'
import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { browserLoginAllowed, useAuth } from './lib/auth'
import { isConfigured } from './lib/supabase'
import { inTelegram, tgUserName } from './lib/telegram'
import { Toaster, toastError } from './lib/toast'
import TournamentsPage from './pages/TournamentsPage'
import TournamentPage from './pages/TournamentPage'
import TournamentTeamPage from './pages/TournamentTeamPage'
import MatchPage from './pages/MatchPage'
import SeriesPage from './pages/SeriesPage'
import PlayersPage from './pages/PlayersPage'
import PlayerPage from './pages/PlayerPage'
import TeamsPage from './pages/TeamsPage'
import TeamPage from './pages/TeamPage'
import ProfilePage from './pages/ProfilePage'

export default function App() {
  const { loading, userId, error, retry } = useAuth()

  if (!isConfigured) return <SetupScreen />
  if (loading) return <div className="welcome"><div className="welcome-logo">⚽</div><p className="muted">Входим…</p></div>
  if (error) return <AuthErrorScreen text={error} onRetry={retry} />
  if (!userId) {
    if (inTelegram) return <AuthErrorScreen text="Не удалось войти через Telegram" onRetry={retry} />
    return browserLoginAllowed ? <WelcomeScreen /> : <OpenInTelegramScreen />
  }

  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Navigate to="/tournaments" replace />} />
        <Route path="/tournaments" element={<TournamentsPage />} />
        <Route path="/tournaments/:id" element={<TournamentPage />} />
        <Route path="/tournaments/:id/teams/:teamId" element={<TournamentTeamPage />} />
        <Route path="/tournaments/:id/matches/:matchId" element={<MatchPage />} />
        <Route path="/series/:id" element={<SeriesPage />} />
        <Route path="/players" element={<PlayersPage />} />
        <Route path="/players/:id" element={<PlayerPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:id" element={<TeamPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/tournaments" replace />} />
      </Routes>
      <nav className="tabbar">
        <NavLink to="/tournaments">
          <span className="tab-icon">🏆</span>Турниры
        </NavLink>
        <NavLink to="/players">
          <span className="tab-icon">👤</span>Игроки
        </NavLink>
        <NavLink to="/teams">
          <span className="tab-icon">👕</span>Команды
        </NavLink>
        <NavLink to="/profile">
          <span className="tab-icon">⚙️</span>Профиль
        </NavLink>
      </nav>
      <Toaster />
    </div>
  )
}

function WelcomeScreen() {
  const { signIn } = useAuth()
  const [name, setName] = useState(tgUserName())
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await signIn(name.trim())
    } catch (err) {
      toastError(err)
      setBusy(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-logo">⚽</div>
      <h1>Турниры</h1>
      <p className="muted">Товарищеские турниры, команды и статистика игроков</p>
      <form className="form" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как тебя зовут?" required autoFocus />
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'Входим…' : 'Начать'}
        </button>
      </form>
      <Toaster />
    </div>
  )
}

function AuthErrorScreen({ text, onRetry }: { text: string; onRetry(): void }) {
  return (
    <div className="welcome">
      <div className="welcome-logo">⚠️</div>
      <h1>Не получилось войти</h1>
      <p className="muted">{text}</p>
      <button className="btn btn-primary btn-block" onClick={onRetry}>
        Попробовать снова
      </button>
    </div>
  )
}

function OpenInTelegramScreen() {
  return (
    <div className="welcome">
      <div className="welcome-logo">⚽</div>
      <h1>Турниры</h1>
      <p className="muted">Приложение открывается из Telegram — через кнопку в нашем боте.</p>
    </div>
  )
}

function SetupScreen() {
  return (
    <div className="welcome">
      <div className="welcome-logo">🔧</div>
      <h1>Нужно подключить Supabase</h1>
      <p className="muted">
        Создайте файл <code>.env</code> по образцу <code>.env.example</code> и перезапустите приложение.
      </p>
    </div>
  )
}
