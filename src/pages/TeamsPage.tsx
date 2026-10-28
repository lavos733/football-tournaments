import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TeamForm } from '../components/TeamForm'
import { Empty, ErrorBox, Loading, Page, TeamBadge } from '../components/ui'
import { playersCount } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { toastError } from '../lib/toast'
import type { Team } from '../lib/types'

type TeamRow = Team & { team_players: { count: number }[]; creator: { display_name: string } | null }

export default function TeamsPage() {
  const nav = useNavigate()
  const [creating, setCreating] = useState(false)
  const { data, loading, error, reload } = useQuery(
    () => q(supabase.from('teams').select('*, team_players(count), creator:profiles!teams_created_by_fkey(display_name)').order('name')),
    [],
  )
  const teams = (data as TeamRow[] | undefined) ?? []

  return (
    <Page
      title="Команды"
      actions={
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          + Команда
        </button>
      }
    >
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox text={error} onRetry={reload} />
      ) : teams.length === 0 ? (
        <Empty title="Команд пока нет">
          <p className="muted">Команда в базе — это название, цвет и обычный состав. Её можно быстро добавить в любой турнир.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            Создать команду
          </button>
        </Empty>
      ) : (
        <div className="list card">
          {teams.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} className="row">
              <TeamBadge color={t.color} size={24} />
              <div className="row-main">
                <div className="row-title">{t.name}</div>
                <div className="row-sub">
                  {playersCount(t.team_players[0]?.count ?? 0)} · {t.creator?.display_name ?? '—'}
                </div>
              </div>
              <span className="chevron">›</span>
            </Link>
          ))}
        </div>
      )}
      <TeamForm
        open={creating}
        title="Новая команда"
        submitLabel="Создать"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          try {
            const t = await q(supabase.from('teams').insert(v).select().single())
            nav(`/teams/${(t as Team).id}`)
          } catch (e) {
            toastError(e)
          }
        }}
      />
    </Page>
  )
}
