import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { PlayersStatsTable, type StatsRow } from '../components/TournamentStats'
import { ErrorBox, Field, Loading, Page, Section, Segmented, Sheet, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { STATUS_LABEL, plural } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction } from '../lib/telegram'
import { toastError } from '../lib/toast'
import type { Match, Player, PlayerTournamentStats, Series, Tournament, TournamentTeam } from '../lib/types'
import { PointsLeaderboard, ScorersLeaderboard } from '../components/SeriesLeaderboards'
import { finalPlaces, seriesPoints, type SeriesPointsRow } from '../lib/seriesPoints'

type MiniPlayer = Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>
type Tab = 'points' | 'scorers' | 'players' | 'tournaments'
type TRow = Tournament & { winner: Pick<TournamentTeam, 'name' | 'color'> | null }

/** Сумма статистики игрока по всем турнирам серии. */
function aggregate(rows: PlayerTournamentStats[]): StatsRow[] {
  const by = new Map<string, StatsRow>()
  for (const r of rows) {
    const s = by.get(r.player_id) ?? {
      player_id: r.player_id, tournaments: 0, matches: 0, wins: 0, draws: 0, losses: 0, goals: 0, assists: 0, own_goals: 0,
      yellow_cards: 0, red_cards: 0, mvp: 0, titles: 0, gk_matches: 0, clean_sheets: 0, goals_conceded: 0,
    }
    if (r.tournament_status !== 'draft') s.tournaments! += 1
    s.matches += r.matches
    s.wins += r.wins
    s.draws += r.draws
    s.losses += r.losses
    s.goals += r.goals
    s.assists += r.assists
    s.own_goals += r.own_goals
    s.yellow_cards += r.yellow_cards
    s.red_cards += r.red_cards
    s.mvp += r.mvp
    s.titles += r.titles
    s.gk_matches += r.gk_matches
    s.clean_sheets += r.clean_sheets
    s.goals_conceded += r.goals_conceded
    by.set(r.player_id, s)
  }
  return [...by.values()]
}

export default function SeriesPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { userId } = useAuth()
  const [tab, setTab] = useState<Tab>('points')
  const [picking, setPicking] = useState(false)
  const [renaming, setRenaming] = useState(false)

  const { data, loading, error, reload } = useQuery(async () => {
    const [series, links] = await Promise.all([
      q(supabase.from('series').select('*').eq('id', id!).single()),
      q(supabase.from('series_tournaments').select('tournament_id').eq('series_id', id!)),
    ])
    const ids = (links as { tournament_id: string }[]).map((l) => l.tournament_id)
    if (ids.length === 0)
      return { series: series as Series, tournaments: [] as TRow[], stats: [] as StatsRow[], points: [] as SeriesPointsRow[], players: new Map<string, MiniPlayer>(), matches: 0 }

    const [tournaments, stats, matches, teams] = await Promise.all([
      q(supabase.from('tournaments').select('*, winner:tournament_teams!tournaments_winner_team_id_fkey(name, color)').in('id', ids).order('created_at')),
      q(supabase.from('player_tournament_stats').select('*').in('tournament_id', ids)),
      q(supabase.from('matches').select('*').in('tournament_id', ids)),
      q(supabase.from('tournament_teams').select('*').in('tournament_id', ids)),
    ])
    const rows = stats as PlayerTournamentStats[]
    const playerIds = [...new Set(rows.map((r) => r.player_id))]
    const players = playerIds.length
      ? ((await q(supabase.from('players').select('id, first_name, last_name, photo_url').in('id', playerIds))) as MiniPlayer[])
      : []
    const places = finalPlaces(tournaments as TRow[], teams as TournamentTeam[], matches as Match[])
    return {
      series: series as Series,
      tournaments: tournaments as TRow[],
      stats: aggregate(rows),
      points: seriesPoints(rows, places),
      players: new Map(players.map((p) => [p.id, p])),
      matches: (matches as Match[]).filter((m) => m.status === 'finished').length,
    }
  }, [id])

  const totalGoals = useMemo(() => (data?.stats ?? []).reduce((n, s) => n + s.goals + s.own_goals, 0), [data])

  if (loading && !data) return <Page title="Серия" back="/tournaments?view=series"><Loading /></Page>
  if (error || !data) return <Page title="Серия" back="/tournaments?view=series"><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const { series, tournaments } = data
  const isOwner = series.created_by === userId

  async function removeTournament(t: Tournament) {
    try {
      await q(supabase.from('series_tournaments').delete().eq('series_id', series.id).eq('tournament_id', t.id))
      reload()
    } catch (e) {
      toastError(e)
    }
  }

  async function removeSeries() {
    if (!(await confirmAction(`Удалить серию «${series.name}»? Сами турниры останутся.`))) return
    try {
      await q(supabase.from('series').delete().eq('id', series.id))
      nav('/tournaments?view=series')
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <Page
      title={series.name}
      back="/tournaments?view=series"
      actions={
        isOwner && (
          <button className="btn btn-ghost btn-sm" onClick={() => setRenaming(true)}>
            Изменить
          </button>
        )
      }
    >
      <div className="t-head card">
        <div className="t-head-row">
          <span className="status">Серия</span>
          <span className="muted">
            {tournaments.length} {plural(tournaments.length, 'турнир', 'турнира', 'турниров')} · {data.matches}{' '}
            {plural(data.matches, 'матч', 'матча', 'матчей')} · {totalGoals} {plural(totalGoals, 'гол', 'гола', 'голов')}
          </span>
        </div>
        <div className="muted small">Общая статистика игроков по всем турнирам серии, за какую бы команду они ни играли.</div>
      </div>

      <div className="tabs">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'points', label: 'Очки' },
            { value: 'scorers', label: 'Голы' },
            { value: 'players', label: 'Игроки' },
            { value: 'tournaments', label: 'Турниры' },
          ]}
        />
      </div>

      {tab !== 'tournaments' && tournaments.length === 0 && <div className="card state">Добавьте турниры во вкладке «Турниры»</div>}
      {tab === 'points' && tournaments.length > 0 && <PointsLeaderboard rows={data.points} players={data.players} />}
      {tab === 'scorers' && tournaments.length > 0 && <ScorersLeaderboard stats={data.stats} players={data.players} />}

      {tab === 'players' && tournaments.length > 0 && (
        <>
          <PlayersStatsTable stats={data.stats} players={data.players} mode="series" />
          <p className="muted small">Т — турниров сыграно, 🏆 — выигранных турниров, ⭐ — раз лучший игрок турнира.</p>
        </>
      )}

      {tab === 'tournaments' && (
        <Section
          title={`Турниры · ${tournaments.length}`}
          right={
            isOwner && (
              <button className="btn btn-ghost btn-sm" onClick={() => setPicking(true)}>
                + Турнир
              </button>
            )
          }
        >
          {tournaments.length === 0 ? (
            <div className="card state">В серии пока нет турниров</div>
          ) : (
            <div className="list card">
              {tournaments.map((t) => (
                <div key={t.id} className="row">
                  <Link to={`/tournaments/${t.id}`} className="row-link">
                    <div className="t-format">{t.format}×{t.format}</div>
                    <div className="row-main">
                      <div className="row-title">{t.name}</div>
                      <div className="row-sub">
                        {t.winner ? (
                          <>
                            🏆 <TeamBadge color={t.winner.color} size={9} /> {t.winner.name}
                          </>
                        ) : (
                          STATUS_LABEL[t.status]
                        )}
                      </div>
                    </div>
                  </Link>
                  {isOwner && (
                    <button className="icon-btn" onClick={() => removeTournament(t)} aria-label="Убрать из серии">
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {isOwner && (
        <button className="btn btn-danger-ghost btn-block" onClick={removeSeries}>
          Удалить серию
        </button>
      )}

      <AddTournamentsSheet
        open={picking}
        seriesId={series.id}
        exclude={new Set(tournaments.map((t) => t.id))}
        onClose={() => setPicking(false)}
        onAdded={() => {
          setPicking(false)
          reload()
        }}
      />
      <SeriesForm
        open={renaming}
        initial={series.name}
        onClose={() => setRenaming(false)}
        onSubmit={async (name) => {
          try {
            await q(supabase.from('series').update({ name }).eq('id', series.id))
            setRenaming(false)
            reload()
          } catch (e) {
            toastError(e)
          }
        }}
      />
    </Page>
  )
}

/** Выбор нескольких турниров сразу. */
function AddTournamentsSheet({
  open,
  seriesId,
  exclude,
  onClose,
  onAdded,
}: {
  open: boolean
  seriesId: string
  exclude: Set<string>
  onClose(): void
  onAdded(): void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const { data, loading } = useQuery(
    () => (open ? q(supabase.from('tournaments').select('*').order('created_at', { ascending: false }).limit(300)) : Promise.resolve([])),
    [open],
  )
  const list = ((data as Tournament[] | undefined) ?? []).filter((t) => !exclude.has(t.id))

  function toggle(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  async function add() {
    setBusy(true)
    try {
      await q(supabase.from('series_tournaments').insert([...selected].map((tournament_id) => ({ series_id: seriesId, tournament_id }))))
      setSelected(new Set())
      onAdded()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Добавить турниры в серию" onClose={onClose}>
      {loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="state">Все турниры уже в серии</div>
      ) : (
        <>
          <div className="list">
            {list.map((t) => (
              <label key={t.id} className="row">
                <input type="checkbox" className="row-check" checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                <div className="row-main">
                  <div className="row-title">{t.name}</div>
                  <div className="row-sub">
                    {t.format}×{t.format} · {STATUS_LABEL[t.status]} · {new Date(t.created_at).toLocaleDateString('ru-RU')}
                  </div>
                </div>
              </label>
            ))}
          </div>
          <div className="sheet-footer">
            <button className="btn btn-primary btn-block" disabled={busy || selected.size === 0} onClick={add}>
              {selected.size ? `Добавить ${selected.size} ${plural(selected.size, 'турнир', 'турнира', 'турниров')}` : 'Выберите турниры'}
            </button>
          </div>
        </>
      )}
    </Sheet>
  )
}

export function SeriesForm({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean
  initial?: string
  onClose(): void
  onSubmit(name: string): Promise<void>
}) {
  const [name, setName] = useState(initial ?? '')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      await onSubmit(name.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={initial ? 'Серия' : 'Новая серия'} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <Field label="Название" hint="Например, «Осень 2026» — сюда можно собрать все недельные турниры сезона">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Осень 2026" required autoFocus />
        </Field>
        <button className="btn btn-primary btn-block" disabled={busy || !name.trim()}>
          {busy ? 'Сохраняю…' : initial ? 'Сохранить' : 'Создать серию'}
        </button>
      </form>
    </Sheet>
  )
}
