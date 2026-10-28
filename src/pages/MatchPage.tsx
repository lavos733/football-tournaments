import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { Avatar, ErrorBox, Loading, Page, Section, Sheet, TeamBadge } from '../components/ui'
import { useAuth } from '../lib/auth'
import { POS_SHORT, fullName } from '../lib/format'
import { useQuery } from '../lib/hooks'
import { q, supabase } from '../lib/supabase'
import { confirmAction, haptic } from '../lib/telegram'
import { toastError } from '../lib/toast'
import type { Match, MatchEvent, MatchGoalkeeper, MatchStatus, Player, RosterEntry, Tournament, TournamentTeam } from '../lib/types'

type Entry = RosterEntry & { player: Player }
type EventKind = 'goal' | 'yellow' | 'red'

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Не начался',
  live: 'Идёт',
  finished: 'Завершён',
}

export default function MatchPage() {
  const { id, matchId } = useParams()
  const { userId } = useAuth()
  const [adding, setAdding] = useState<{ kind: EventKind; teamId: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const { data, loading, error, reload } = useQuery(async () => {
    const [m, t, judges, teams, roster, events, gks, absences] = await Promise.all([
      q(supabase.from('matches').select('*').eq('id', matchId!).single()),
      q(supabase.from('tournaments').select('*').eq('id', id!).single()),
      q(supabase.from('tournament_judges').select('profile_id').eq('tournament_id', id!)),
      q(supabase.from('tournament_teams').select('*').eq('tournament_id', id!)),
      q(supabase.from('roster_entries').select('*, player:players(*)').eq('tournament_id', id!)),
      q(supabase.from('match_events').select('*').eq('match_id', matchId!).order('created_at')),
      q(supabase.from('match_goalkeepers').select('*').eq('match_id', matchId!)),
      q(supabase.from('match_absences').select('player_id').eq('match_id', matchId!)),
    ])
    return {
      m: m as Match,
      t: t as Tournament,
      judges: (judges as { profile_id: string }[]).map((j) => j.profile_id),
      teams: teams as TournamentTeam[],
      roster: roster as Entry[],
      events: events as MatchEvent[],
      gks: gks as MatchGoalkeeper[],
      absent: new Set((absences as { player_id: string }[]).map((a) => a.player_id)),
    }
  }, [id, matchId])

  const back = `/tournaments/${id}`
  if (loading && !data) return <Page title="Матч" back={back}><Loading /></Page>
  if (error || !data) return <Page title="Матч" back={back}><ErrorBox text={error ?? 'Не найдено'} onRetry={reload} /></Page>

  const { m, t, events, gks, absent } = data
  const home = data.teams.find((x) => x.id === m.home_team_id)!
  const away = data.teams.find((x) => x.id === m.away_team_id)!
  const canEdit = t.status === 'active' && (t.created_by === userId || data.judges.includes(userId!))
  // события добавляются и удаляются только в идущем матче; завершённый сначала открывают «Исправить результат»
  const canAddEvents = canEdit && m.status === 'live'

  const rosterOf = (teamId: string) =>
    data.roster
      .filter((r) => r.tournament_team_id === teamId)
      .sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || fullName(a.player).localeCompare(fullName(b.player), 'ru'))
  const homeRoster = rosterOf(home.id)
  const awayRoster = rosterOf(away.id)
  const played = (r: Entry[]) => r.filter((e) => !absent.has(e.player_id))
  const entryById = new Map(data.roster.map((r) => [r.player_id, r]))
  const nameOf = (pid: string | null) => {
    if (!pid) return 'Автор неизвестен'
    const e = entryById.get(pid)
    return e ? fullName(e.player) : '—'
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    try {
      await action()
      haptic('success')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
      reload()
    }
  }

  const setStatus = (status: MatchStatus) =>
    run(async () => {
      await q(supabase.rpc('set_match_status', { p_match: m.id, p_status: status }))
      // при старте подставляем вратарей: игрок с позицией «Вратарь», если он один в составе
      if (status === 'live') {
        for (const [team, roster] of [[home, homeRoster], [away, awayRoster]] as const) {
          if (gks.some((g) => g.team_id === team.id)) continue
          const keepers = played(roster).filter((r) => r.player.position === 'GK')
          if (keepers.length === 1) {
            await q(supabase.from('match_goalkeepers').upsert({ match_id: m.id, team_id: team.id, player_id: keepers[0]!.player_id }))
          }
        }
      }
    })

  const removeEvent = (ev: MatchEvent) =>
    run(async () => {
      if (!(await confirmAction('Удалить событие?'))) return
      await q(supabase.from('match_events').delete().eq('id', ev.id))
    })

  const setGoalkeeper = (teamId: string, playerId: string) =>
    run(() =>
      playerId
        ? q(supabase.from('match_goalkeepers').upsert({ match_id: m.id, team_id: teamId, player_id: playerId }))
        : q(supabase.from('match_goalkeepers').delete().eq('match_id', m.id).eq('team_id', teamId)),
    )

  const toggleAbsent = (playerId: string) =>
    run(() =>
      absent.has(playerId)
        ? q(supabase.from('match_absences').delete().eq('match_id', m.id).eq('player_id', playerId))
        : q(supabase.from('match_absences').insert({ match_id: m.id, player_id: playerId })),
    )

  // счёт по ходу матча для ленты
  let h = 0
  let a = 0
  const timeline = events.map((ev) => {
    if (ev.type === 'goal' || ev.type === 'own_goal') {
      if (ev.team_id === home.id) h++
      else a++
    }
    return { ev, score: `${h}:${a}` }
  })

  const played_ = m.status !== 'scheduled'

  return (
    <Page title={`Тур ${m.matchday}`} back={back}>
      <div className={`scoreboard card status-bg-${m.status}`}>
        <div className="sb-team">
          <TeamBadge color={home.color} size={40} />
          <span>{home.name}</span>
        </div>
        <div className="sb-center">
          <div className="sb-score">{played_ ? `${m.home_score ?? 0} : ${m.away_score ?? 0}` : '– : –'}</div>
          <div className={`sb-status sb-status-${m.status}`}>{MATCH_STATUS_LABEL[m.status]}</div>
        </div>
        <div className="sb-team">
          <TeamBadge color={away.color} size={40} />
          <span>{away.name}</span>
        </div>
      </div>

      {canEdit && (
        <div className="match-actions">
          {m.status === 'scheduled' && (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => setStatus('live')}>
              ▶ Начать матч
            </button>
          )}
          {m.status === 'live' && (
            <button className="btn btn-primary btn-block" disabled={busy} onClick={() => setStatus('finished')}>
              Завершить матч
            </button>
          )}
          {m.status === 'finished' && (
            <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => setStatus('live')}>
              Исправить результат
            </button>
          )}
          {m.status === 'live' && events.length === 0 && (
            <button className="btn btn-ghost btn-block" disabled={busy} onClick={() => setStatus('scheduled')}>
              Отменить начало
            </button>
          )}
        </div>
      )}

      {canAddEvents && (
        <div className="event-buttons">
          {[home, away].map((team) => (
            <div key={team.id} className="event-col">
              <div className="event-col-title">
                <TeamBadge color={team.color} /> {team.name}
              </div>
              <div className="event-col-btns">
                <button className="btn btn-secondary btn-sm" onClick={() => setAdding({ kind: 'goal', teamId: team.id })}>
                  ⚽ Гол
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setAdding({ kind: 'yellow', teamId: team.id })}>
                  🟨
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setAdding({ kind: 'red', teamId: team.id })}>
                  🟥
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {played_ && (
        <Section title="События">
          {timeline.length === 0 ? (
            <div className="card state">Пока без событий</div>
          ) : (
            <div className="list card">
              {timeline.map(({ ev, score }) => {
                const isHome = ev.team_id === home.id
                const isGoal = ev.type === 'goal' || ev.type === 'own_goal'
                return (
                  <div key={ev.id} className={`event ${isHome ? 'event-home' : 'event-away'}`}>
                    <span className="event-icon">{isGoal ? '⚽' : ev.type === 'yellow' ? '🟨' : '🟥'}</span>
                    <div className="event-main">
                      <div className="event-title">
                        {nameOf(ev.player_id)}
                        {ev.type === 'own_goal' && <span className="muted"> (автогол)</span>}
                      </div>
                      {ev.assist_player_id && <div className="event-sub">пас: {nameOf(ev.assist_player_id)}</div>}
                    </div>
                    {isGoal && <span className="event-score">{score}</span>}
                    {canAddEvents && (
                      <button className="icon-btn" onClick={() => removeEvent(ev)} aria-label="Удалить событие">
                        ✕
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}

      <Section title="Вратари">
        <div className="card gk-grid">
          {[
            { team: home, list: played(homeRoster) },
            { team: away, list: played(awayRoster) },
          ].map(({ team, list }) => {
            const gk = gks.find((g) => g.team_id === team.id)
            return (
              <label key={team.id} className="field">
                <span className="field-label">
                  <TeamBadge color={team.color} size={10} /> {team.name}
                </span>
                {canEdit ? (
                  <select value={gk?.player_id ?? ''} onChange={(e) => setGoalkeeper(team.id, e.target.value)} disabled={busy}>
                    <option value="">— не указан —</option>
                    {list.map((r) => (
                      <option key={r.player_id} value={r.player_id}>
                        {fullName(r.player)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span>{gk ? nameOf(gk.player_id) : '—'}</span>
                )}
              </label>
            )
          })}
        </div>
      </Section>

      <Section title="Составы">
        {canEdit && <p className="muted small">По умолчанию сыграла вся заявка. Снимите галочку с тех, кто не играл.</p>}
        <div className="lineups">
          {[
            { team: home, list: homeRoster },
            { team: away, list: awayRoster },
          ].map(({ team, list }) => (
            <div key={team.id} className="card lineup">
              <div className="lineup-head">
                <TeamBadge color={team.color} /> {team.name}
              </div>
              {list.map((r) => {
                const isAbsent = absent.has(r.player_id)
                return (
                  <label key={r.player_id} className={`lineup-row ${isAbsent ? 'absent' : ''}`}>
                    {canEdit && <input type="checkbox" checked={!isAbsent} onChange={() => toggleAbsent(r.player_id)} disabled={busy} />}
                    <span className="lineup-num">{r.number ?? '–'}</span>
                    <span className="lineup-name">{fullName(r.player)}</span>
                    {r.player.position && <span className="muted small">{POS_SHORT[r.player.position]}</span>}
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </Section>

      {adding && (
        <EventSheet
          kind={adding.kind}
          team={adding.teamId === home.id ? home : away}
          own={played(adding.teamId === home.id ? homeRoster : awayRoster)}
          opponent={played(adding.teamId === home.id ? awayRoster : homeRoster)}
          onClose={() => setAdding(null)}
          onSubmit={async (ev) => {
            setAdding(null)
            await run(() => q(supabase.from('match_events').insert({ match_id: m.id, ...ev })))
          }}
        />
      )}
    </Page>
  )
}

type NewEvent = Pick<MatchEvent, 'type' | 'team_id' | 'player_id' | 'assist_player_id'>

/** Пошаговый ввод события: гол → автор → ассист; карточка → игрок. */
function EventSheet({
  kind,
  team,
  own,
  opponent,
  onClose,
  onSubmit,
}: {
  kind: EventKind
  team: TournamentTeam
  own: Entry[]
  opponent: Entry[]
  onClose(): void
  onSubmit(ev: NewEvent): void
}) {
  const [scorer, setScorer] = useState<string | null | undefined>(undefined)

  const title = kind === 'goal' ? (scorer === undefined ? `Гол · ${team.name}` : 'Кто отдал пас?') : `${kind === 'yellow' ? 'Жёлтая' : 'Красная'} карточка · ${team.name}`

  const playerRow = (r: Entry, onClick: () => void) => (
    <button key={r.player_id} className="row" onClick={onClick}>
      <span className="number">{r.number ?? '–'}</span>
      <Avatar src={r.player.photo_url} name={fullName(r.player)} size={32} />
      <div className="row-main">
        <div className="row-title">{fullName(r.player)}</div>
      </div>
    </button>
  )

  return (
    <Sheet open title={title} onClose={onClose}>
      {kind !== 'goal' && (
        <div className="list">
          {own.map((r) =>
            playerRow(r, () => onSubmit({ type: kind, team_id: team.id, player_id: r.player_id, assist_player_id: null })),
          )}
        </div>
      )}

      {kind === 'goal' && scorer === undefined && (
        <>
          <div className="list">
            {own.map((r) => playerRow(r, () => setScorer(r.player_id)))}
            <button className="row" onClick={() => onSubmit({ type: 'goal', team_id: team.id, player_id: null, assist_player_id: null })}>
              <div className="row-main">
                <div className="row-title">Автор неизвестен</div>
              </div>
            </button>
          </div>
          {opponent.length > 0 && (
            <>
              <div className="section-head">
                <span>Автогол игрока соперника</span>
              </div>
              <div className="list">
                {opponent.map((r) =>
                  playerRow(r, () => onSubmit({ type: 'own_goal', team_id: team.id, player_id: r.player_id, assist_player_id: null })),
                )}
              </div>
            </>
          )}
        </>
      )}

      {kind === 'goal' && scorer !== undefined && (
        <div className="list">
          <button className="row" onClick={() => onSubmit({ type: 'goal', team_id: team.id, player_id: scorer, assist_player_id: null })}>
            <div className="row-main">
              <div className="row-title">Без ассиста</div>
            </div>
          </button>
          {own
            .filter((r) => r.player_id !== scorer)
            .map((r) => playerRow(r, () => onSubmit({ type: 'goal', team_id: team.id, player_id: scorer, assist_player_id: r.player_id })))}
        </div>
      )}
    </Sheet>
  )
}
