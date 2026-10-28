import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TournamentForm } from '../components/TournamentForm'
import { Empty, ErrorBox, Loading, Page, Segmented, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { STATUS_LABEL, plural } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { toastError } from '../lib/toast'
import type { Series, Tournament, TournamentTeam } from '../lib/types'
import { SeriesForm } from './SeriesPage'

type Row = Tournament & {
  organizer: { display_name: string } | null
  tournament_teams: { count: number }[]
  winner: Pick<TournamentTeam, 'name' | 'color'> | null
}
type SeriesRow = Series & { series_tournaments: { count: number }[]; creator: { display_name: string } | null }
type View = 'all' | 'mine' | 'series'

export default function TournamentsPage() {
  const nav = useNavigate()
  const { userId } = useAuth()
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View | null) ?? 'all'
  const setView = (v: View) => setParams(v === 'all' ? {} : { view: v }, { replace: true })
  const [creating, setCreating] = useState(false)
  const [creatingSeries, setCreatingSeries] = useState(false)

  const { data, loading, error, reload } = useQuery(
    () =>
      view === 'series'
        ? q(
            supabase
              .from('series')
              .select('*, series_tournaments(count), creator:profiles!series_created_by_fkey(display_name)')
              .order('created_at', { ascending: false }),
          )
        : q(
            supabase
              .from('tournaments')
              .select(
                '*, organizer:profiles!tournaments_created_by_fkey(display_name), tournament_teams!tournament_teams_tournament_id_fkey(count), winner:tournament_teams!tournaments_winner_team_id_fkey(name, color)',
              )
              .order('created_at', { ascending: false })
              .limit(200),
          ),
    [view === 'series'],
  )

  return (
    <Page
      title="Турниры"
      actions={
        view === 'series' ? (
          <button className="btn btn-primary btn-sm" onClick={() => setCreatingSeries(true)}>
            + Серия
          </button>
        ) : (
          <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
            + Турнир
          </button>
        )
      }
    >
      <div className="toolbar">
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: 'all', label: 'Все' },
            { value: 'mine', label: 'Мои' },
            { value: 'series', label: 'Серии' },
          ]}
        />
      </div>
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox text={error} onRetry={reload} />
      ) : view === 'series' ? (
        <SeriesList rows={(data as SeriesRow[] | undefined) ?? []} onCreate={() => setCreatingSeries(true)} />
      ) : (
        <TournamentList
          rows={((data as Row[] | undefined) ?? []).filter((t) => view === 'all' || t.created_by === userId)}
          mine={view === 'mine'}
          onCreate={() => setCreating(true)}
        />
      )}
      <TournamentForm
        open={creating}
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          try {
            const t = await q(supabase.from('tournaments').insert(v).select().single())
            nav(`/tournaments/${(t as Tournament).id}`)
          } catch (e) {
            toastError(e)
          }
        }}
      />
      <SeriesForm
        open={creatingSeries}
        onClose={() => setCreatingSeries(false)}
        onSubmit={async (name) => {
          try {
            const s = await q(supabase.from('series').insert({ name }).select().single())
            nav(`/series/${(s as Series).id}`)
          } catch (e) {
            toastError(e)
          }
        }}
      />
    </Page>
  )
}

function TournamentList({ rows, mine, onCreate }: { rows: Row[]; mine: boolean; onCreate(): void }) {
  if (rows.length === 0)
    return (
      <Empty title={mine ? 'Вы ещё не создавали турниров' : 'Турниров пока нет'}>
        <button className="btn btn-primary" onClick={onCreate}>
          Создать турнир
        </button>
      </Empty>
    )
  return (
    <div className="list card">
      {rows.map((t) => {
        const teams = t.tournament_teams[0]?.count ?? 0
        return (
          <Link key={t.id} to={`/tournaments/${t.id}`} className="row">
            <div className="t-format">{t.format}×{t.format}</div>
            <div className="row-main">
              <div className="row-title">{t.name}</div>
              <div className="row-sub">
                {t.winner ? (
                  <>
                    🏆 <TeamBadge color={t.winner.color} size={9} /> {t.winner.name}
                  </>
                ) : (
                  <>
                    {teams} {plural(teams, 'команда', 'команды', 'команд')} · {t.rounds} {plural(t.rounds, 'круг', 'круга', 'кругов')} ·{' '}
                    {t.organizer?.display_name ?? '—'}
                  </>
                )}
              </div>
            </div>
            <span className={`status status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          </Link>
        )
      })}
    </div>
  )
}

function SeriesList({ rows, onCreate }: { rows: SeriesRow[]; onCreate(): void }) {
  if (rows.length === 0)
    return (
      <Empty title="Серий пока нет">
        <p className="muted">Серия объединяет несколько турниров — например, все недельные турниры сезона — и показывает общую статистику игроков.</p>
        <button className="btn btn-primary" onClick={onCreate}>
          Создать серию
        </button>
      </Empty>
    )
  return (
    <div className="list card">
      {rows.map((s) => {
        const n = s.series_tournaments[0]?.count ?? 0
        return (
          <Link key={s.id} to={`/series/${s.id}`} className="row">
            <div className="t-format">🔗</div>
            <div className="row-main">
              <div className="row-title">{s.name}</div>
              <div className="row-sub">
                {n} {plural(n, 'турнир', 'турнира', 'турниров')} · {s.creator?.display_name ?? '—'}
              </div>
            </div>
            <span className="chevron">›</span>
          </Link>
        )
      })}
    </div>
  )
}
