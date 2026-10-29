import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { JudgesSection, type JudgeRow } from '../components/JudgesSection'
import { TeamForm } from '../components/TeamForm'
import { TournamentForm } from '../components/TournamentForm'
import { PlayersStatsTable, StandingsTable } from '../components/TournamentStats'
import { ErrorBox, Loading, Page, Section, Segmented, Sheet, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { ROSTER_LIMITS, STATUS_LABEL, fullName, playersCount, plural } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { computeStandings } from '../lib/standings'
import { q, supabase } from '../lib/supabase'
import { confirmAction, haptic } from '../lib/telegram'
import { toast, toastError } from '../lib/toast'
import type { Match, Player, PlayerTournamentStats, Series, Team, Tournament, TournamentTeam } from '../lib/types'
import { FinishTournamentSheet, MvpSelect } from '../components/FinishTournamentSheet'

type TRow = Tournament & { organizer: { display_name: string } | null }
type TeamRow = TournamentTeam & { roster_entries: { count: number }[] }
type Tab = 'matches' | 'table' | 'players' | 'teams'
type MiniPlayer = Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>

export default function TournamentPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const { userId } = useAuth()
  const [tab, setTab] = useState<Tab | null>(null)
  const [settings, setSettings] = useState(false)
  const [adding, setAdding] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useQuery(async () => {
    const [t, teams, matches, judges, stats, roster, seriesRows] = await Promise.all([
      q(supabase.from('tournaments').select('*, organizer:profiles!tournaments_created_by_fkey(display_name)').eq('id', id!).single()),
      q(supabase.from('tournament_teams').select('*, roster_entries(count)').eq('tournament_id', id!).order('seed', { nullsFirst: false }).order('created_at')),
      q(supabase.from('matches').select('*').eq('tournament_id', id!).order('matchday').order('position')),
      q(supabase.from('tournament_judges').select('profile_id, profile:profiles(display_name, username)').eq('tournament_id', id!)),
      q(supabase.from('player_tournament_stats').select('*').eq('tournament_id', id!)),
      q(supabase.from('roster_entries').select('tournament_team_id, player:players(id, first_name, last_name, photo_url)').eq('tournament_id', id!)),
      q(supabase.from('series_tournaments').select('series:series(id, name)').eq('tournament_id', id!)),
    ])
    return {
      rosterTeam: new Map((roster as { tournament_team_id: string; player: MiniPlayer }[]).map((r) => [r.player.id, r.tournament_team_id])),
      series: (seriesRows as { series: Pick<Series, 'id' | 'name'> }[]).map((r) => r.series),
      t: t as TRow,
      teams: teams as TeamRow[],
      matches: matches as Match[],
      judges: judges as JudgeRow[],
      stats: stats as PlayerTournamentStats[],
      players: new Map((roster as { player: MiniPlayer }[]).map((r) => [r.player.id, r.player])),
    }
  }, [id])

  const teamById = useMemo(() => new Map<string, TournamentTeam>((data?.teams ?? []).map((t) => [t.id, t])), [data])

  if (loading && !data) return <Page title="Турнир" back="/tournaments"><Loading /></Page>
  if (error || !data) return <Page title="Турнир" back="/tournaments"><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const { t, teams, matches } = data
  const isOwner = t.created_by === userId
  // судьи управляют турниром наравне с организатором; удалить турнир и назначать судей — только организатор
  const canManage = isOwner || data.judges.some((j) => j.profile_id === userId)
  const isDraft = t.status === 'draft'
  const canEditTeams = canManage && isDraft
  const [min, max] = ROSTER_LIMITS[t.format]
  const currentTab = tab ?? (isDraft && matches.length === 0 ? 'teams' : 'matches')

  /** Любое изменение состава турнира делает расписание неактуальным. */
  async function resetSchedule() {
    if (matches.length === 0) return
    await q(supabase.from('matches').delete().eq('tournament_id', t.id))
    toast('Расписание сброшено — составьте его заново')
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    try {
      await action()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
      reload()
    }
  }

  const generate = (shuffle: boolean) =>
    run(async () => {
      if (shuffle) {
        const order = teams.map((x) => x.id).sort(() => Math.random() - 0.5)
        await Promise.all(order.map((teamId, i) => q(supabase.from('tournament_teams').update({ seed: i + 1 }).eq('id', teamId))))
      }
      const n = await q(supabase.rpc('generate_schedule', { p_tournament: t.id }))
      haptic('success')
      toast(`Расписание готово: ${n} ${plural(Number(n), 'матч', 'матча', 'матчей')}`)
      setTab('matches')
    })

  const start = () =>
    run(async () => {
      if (!(await confirmAction('Начать турнир? Состав команд и расписание будут зафиксированы.'))) return
      await q(supabase.rpc('start_tournament', { p_tournament: t.id }))
      haptic('success')
    })

  const backToDraft = () =>
    run(async () => {
      if (!(await confirmAction('Вернуть турнир в подготовку? Можно будет менять команды и расписание.'))) return
      await q(supabase.rpc('reset_tournament_to_draft', { p_tournament: t.id }))
    })

  const finish = (mvpId: string | null) =>
    run(async () => {
      if (mvpId !== t.mvp_player_id) await q(supabase.from('tournaments').update({ mvp_player_id: mvpId }).eq('id', t.id))
      await q(supabase.rpc('finish_tournament', { p_tournament: t.id, p_winner: computeStandings(teams, matches)[0]!.team.id }))
      haptic('success')
      setFinishing(false)
      setTab('table')
    })

  const setMvp = (mvpId: string) => run(() => q(supabase.from('tournaments').update({ mvp_player_id: mvpId || null }).eq('id', t.id)))

  const reopen = () =>
    run(async () => {
      if (!(await confirmAction('Возобновить турнир, чтобы исправить результаты?'))) return
      await q(supabase.rpc('reopen_tournament', { p_tournament: t.id }))
    })

  const allFinished = matches.length > 0 && matches.every((m) => m.status === 'finished')
  const champion = t.status === 'finished' ? teams.find((x) => x.id === t.winner_team_id) ?? computeStandings(teams, matches)[0]?.team : undefined
  const mvp = t.mvp_player_id ? data.players.get(t.mvp_player_id) : undefined

  async function removeTournament() {
    if (!(await confirmAction(`Удалить турнир «${t.name}» целиком?`))) return
    try {
      await q(supabase.from('tournaments').delete().eq('id', t.id))
      nav('/tournaments')
    } catch (e) {
      toastError(e)
    }
  }

  // ---- матчи по турам ----
  const tours = new Map<number, Match[]>()
  for (const m of matches) tours.set(m.matchday, [...(tours.get(m.matchday) ?? []), m])

  const teamsInvalid = teams.filter((x) => {
    const c = x.roster_entries[0]?.count ?? 0
    return c < min || c > max
  })

  return (
    <Page
      title={t.name}
      back="/tournaments"
      actions={
        canManage && (
          <button className="btn btn-ghost btn-sm" onClick={() => setSettings(true)}>
            Настройки
          </button>
        )
      }
    >
      <div className="t-head card">
        <div className="t-head-row">
          <span className={`status status-${t.status}`}>{STATUS_LABEL[t.status]}</span>
          <span className="muted">
            {t.format}×{t.format} · {t.rounds} {plural(t.rounds, 'круг', 'круга', 'кругов')} · {teams.length}{' '}
            {plural(teams.length, 'команда', 'команды', 'команд')}
          </span>
        </div>
        <div className="muted small">Организатор: {t.organizer?.display_name ?? '—'}</div>
      </div>

      {data.series.length > 0 && (
        <div className="series-links">
          {data.series.map((s) => (
            <Link key={s.id} to={`/series/${s.id}`} className="chip">
              🔗 {s.name}
            </Link>
          ))}
        </div>
      )}

      {champion && (
        <div className="champion card">
          <span className="champion-cup">🏆</span>
          <div className="champion-body">
            <div className="muted small">Победитель</div>
            <div className="champion-name">
              <TeamBadge color={champion.color} /> {champion.name}
            </div>
            {canManage ? (
              <label className="field champion-mvp">
                <span className="field-label">⭐ Лучший игрок турнира</span>
                <MvpSelect value={t.mvp_player_id ?? ''} onChange={setMvp} teams={teams} players={data.players} rosterTeam={data.rosterTeam} disabled={busy} />
              </label>
            ) : (
              mvp && (
                <Link to={`/players/${mvp.id}`} className="champion-mvp-link">
                  ⭐ Лучший игрок: <b>{fullName(mvp)}</b>
                </Link>
              )
            )}
          </div>
        </div>
      )}

      <div className="tabs">
        <Segmented<Tab>
          value={currentTab}
          onChange={setTab}
          options={[
            { value: 'matches', label: 'Матчи' },
            { value: 'table', label: 'Таблица' },
            { value: 'players', label: 'Игроки' },
            { value: 'teams', label: 'Команды' },
          ]}
        />
      </div>

      {currentTab === 'table' &&
        (teams.length === 0 ? <div className="card state">Команд пока нет</div> : <StandingsTable teams={teams} matches={matches} />)}

      {currentTab === 'players' && <PlayersStatsTable stats={data.stats} players={data.players} teams={teamById} />}

      {currentTab === 'teams' && (
        <>
          {teams.length === 0 ? (
            <div className="card state">
              <p className="state-title">Команд пока нет</p>
              {canEditTeams && <p className="muted">Добавьте 3–4 команды: из базы или новые.</p>}
            </div>
          ) : (
            <div className="list card">
              {teams.map((x) => {
                const c = x.roster_entries[0]?.count ?? 0
                const ok = c >= min && c <= max
                return (
                  <Link key={x.id} to={`/tournaments/${t.id}/teams/${x.id}`} className="row">
                    <TeamBadge color={x.color} size={24} />
                    <div className="row-main">
                      <div className="row-title">{x.name}</div>
                      <div className={`row-sub ${ok ? '' : 'text-danger'}`}>
                        {playersCount(c)}
                        {!ok && ` · нужно ${min}–${max}`}
                      </div>
                    </div>
                    <span className="chevron">›</span>
                  </Link>
                )
              })}
            </div>
          )}
          {canEditTeams && (
            <button className="btn btn-secondary btn-block" onClick={() => setAdding(true)}>
              + Добавить команду
            </button>
          )}
          {canEditTeams && teams.length >= 2 && (
            <button className="btn btn-primary btn-block" disabled={busy || teamsInvalid.length > 0} onClick={() => generate(false)}>
              {matches.length ? 'Составить расписание заново' : 'Составить расписание'}
            </button>
          )}
          {canEditTeams && teamsInvalid.length > 0 && teams.length >= 2 && (
            <p className="muted small center">Чтобы составить расписание, в каждой команде должно быть от {min} до {max} игроков.</p>
          )}
          <JudgesSection tournamentId={t.id} ownerId={t.created_by} judges={data.judges} isOwner={isOwner} onChange={reload} />
        </>
      )}

      {currentTab === 'matches' && (
        <>
          {matches.length === 0 ? (
            <div className="card state">
              <p className="state-title">Расписания пока нет</p>
              {canEditTeams && <p className="muted">Добавьте команды и нажмите «Составить расписание».</p>}
            </div>
          ) : (
            [...tours.entries()].map(([day, list]) => {
              const playing = new Set(list.flatMap((m) => [m.home_team_id, m.away_team_id]))
              const resting = teams.filter((x) => !playing.has(x.id))
              const circle = list[0]!.circle
              return (
                <Section key={day} title={`Тур ${day}${t.rounds > 1 ? ` · Круг ${circle}` : ''}`}>
                  <div className="list card">
                    {list.map((m) => (
                      <MatchRow
                        key={m.id}
                        m={m}
                        to={isDraft ? undefined : `/tournaments/${t.id}/matches/${m.id}`}
                        home={teamById.get(m.home_team_id)}
                        away={teamById.get(m.away_team_id)}
                      />
                    ))}
                  </div>
                  {resting.length > 0 && <div className="resting">Отдыхает: {resting.map((x) => x.name).join(', ')}</div>}
                </Section>
              )
            })
          )}

          {canEditTeams && matches.length > 0 && (
            <>
              <button className="btn btn-primary btn-block" disabled={busy} onClick={start}>
                Начать турнир
              </button>
              <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => generate(true)}>
                🔀 Перемешать порядок матчей
              </button>
            </>
          )}
          {canManage && t.status === 'active' && (
            <>
              <button className="btn btn-primary btn-block" disabled={busy || !allFinished} onClick={() => setFinishing(true)}>
                Завершить турнир
              </button>
              {!allFinished && <p className="muted small center">Завершить турнир можно, когда сыграны все матчи.</p>}
              {matches.every((m) => m.status === 'scheduled') && (
                <button className="btn btn-ghost btn-block" disabled={busy} onClick={backToDraft}>
                  Вернуть в подготовку
                </button>
              )}
            </>
          )}
          {canManage && t.status === 'finished' && (
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={reopen}>
              Возобновить турнир
            </button>
          )}
        </>
      )}

      <FinishTournamentSheet
        open={finishing}
        winner={computeStandings(teams, matches)[0]?.team}
        teams={teams}
        players={data.players}
        rosterTeam={data.rosterTeam}
        stats={data.stats}
        initialMvp={t.mvp_player_id}
        onClose={() => setFinishing(false)}
        onSubmit={finish}
      />

      <AddTeamSheet
        open={adding}
        tournament={t}
        existing={teams}
        onClose={() => setAdding(false)}
        onAdded={async (teamId) => {
          setAdding(false)
          await resetSchedule().catch(toastError)
          nav(`/tournaments/${t.id}/teams/${teamId}`)
        }}
      />

      <TournamentForm
        open={settings}
        tournament={t}
        onClose={() => setSettings(false)}
        onSubmit={async (v) => {
          try {
            const structural = v.format !== t.format || v.rounds !== t.rounds
            if (structural && !isDraft) {
              toastError({ message: 'Формат и число кругов можно менять только до старта турнира' })
              return
            }
            await q(supabase.from('tournaments').update(v).eq('id', t.id))
            if (structural) await resetSchedule()
            setSettings(false)
            reload()
          } catch (e) {
            toastError(e)
          }
        }}
      />
      {isOwner && (
        <button className="btn btn-danger-ghost btn-block" onClick={removeTournament}>
          Удалить турнир
        </button>
      )}
    </Page>
  )
}

function MatchRow({ m, to, home, away }: { m: Match; to?: string; home?: TournamentTeam; away?: TournamentTeam }) {
  const played = m.home_score !== null && m.away_score !== null
  const body = (
    <>
      <div className="match-team match-home">
        <span className="match-name">{home?.name ?? '?'}</span>
        <TeamBadge color={home?.color ?? '#999'} />
      </div>
      <div className={`match-score ${played ? '' : 'pending'} ${m.status === 'live' ? 'live' : ''}`}>
        {played ? `${m.home_score} : ${m.away_score}` : '– : –'}
        {m.status === 'live' && <span className="live-dot">LIVE</span>}
      </div>
      <div className="match-team">
        <TeamBadge color={away?.color ?? '#999'} />
        <span className="match-name">{away?.name ?? '?'}</span>
      </div>
    </>
  )
  return to ? (
    <Link to={to} className="match">
      {body}
    </Link>
  ) : (
    <div className="match">{body}</div>
  )
}

/** Добавить команду в турнир: из базы (вместе с обычным составом) или новую. */
function AddTeamSheet({
  open,
  tournament,
  existing,
  onClose,
  onAdded,
}: {
  open: boolean
  tournament: Tournament
  existing: TournamentTeam[]
  onClose(): void
  onAdded(tournamentTeamId: string): void
}) {
  const [creating, setCreating] = useState(false)
  const { data, loading } = useQuery(
    () => (open ? q(supabase.from('teams').select('*, team_players(player_id)').order('name')) : Promise.resolve([])),
    [open],
  )
  const used = new Set(existing.map((x) => x.team_id))
  const base = ((data as (Team & { team_players: { player_id: string }[] })[] | undefined) ?? []).filter((x) => !used.has(x.id))
  const nextSeed = existing.length + 1

  async function addFromBase(team: Team & { team_players: { player_id: string }[] }) {
    try {
      const tt = (await q(
        supabase
          .from('tournament_teams')
          .insert({ tournament_id: tournament.id, team_id: team.id, name: team.name, color: team.color, seed: nextSeed })
          .select()
          .single(),
      )) as TournamentTeam

      // переносим обычный состав, пропуская тех, кто уже заявлен за другую команду турнира
      const taken = (await q(supabase.from('roster_entries').select('player_id').eq('tournament_id', tournament.id))) as { player_id: string }[]
      const takenIds = new Set(taken.map((r) => r.player_id))
      const [, max] = ROSTER_LIMITS[tournament.format]
      const free = team.team_players.map((x) => x.player_id).filter((pid) => !takenIds.has(pid))
      const toAdd = free.slice(0, max)
      if (toAdd.length) {
        await q(
          supabase
            .from('roster_entries')
            .insert(toAdd.map((player_id, i) => ({ tournament_id: tournament.id, tournament_team_id: tt.id, player_id, number: i + 1 }))),
        )
      }
      const skipped = team.team_players.length - toAdd.length
      if (skipped > 0) toast(`${playersCount(skipped)} не перенесено: уже в другой команде или превышен лимит заявки`)
      onAdded(tt.id)
    } catch (e) {
      toastError(e)
    }
  }

  return (
    <>
      <Sheet open={open && !creating} title="Добавить команду" onClose={onClose}>
        <button className="btn btn-primary btn-block" onClick={() => setCreating(true)}>
          + Новая команда
        </button>
        <div className="section-head">
          <span>Из базы команд</span>
        </div>
        {loading ? (
          <Loading />
        ) : base.length === 0 ? (
          <div className="state">В базе нет свободных команд. Создайте новую — её можно собрать прямо здесь.</div>
        ) : (
          <div className="list">
            {base.map((team) => (
              <button key={team.id} className="row" onClick={() => addFromBase(team)}>
                <TeamBadge color={team.color} size={24} />
                <div className="row-main">
                  <div className="row-title">{team.name}</div>
                  <div className="row-sub">{playersCount(team.team_players.length)} в обычном составе</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Sheet>
      <TeamForm
        open={open && creating}
        title="Новая команда турнира"
        submitLabel="Добавить"
        onClose={() => setCreating(false)}
        onSubmit={async (v) => {
          try {
            const tt = (await q(
              supabase
                .from('tournament_teams')
                .insert({ tournament_id: tournament.id, name: v.name, color: v.color, seed: nextSeed })
                .select()
                .single(),
            )) as TournamentTeam
            setCreating(false)
            onAdded(tt.id)
          } catch (e) {
            toastError(e)
          }
        }}
      />
    </>
  )
}
