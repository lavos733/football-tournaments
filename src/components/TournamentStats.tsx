import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fullName } from '../lib/format'
import { computeStandings } from '../lib/standings'
import type { Match, Player, PlayerStats, TournamentTeam } from '../lib/types'
import { Avatar, Segmented, TeamBadge } from './ui'

export function StandingsTable({ teams, matches }: { teams: TournamentTeam[]; matches: Match[] }) {
  const rows = computeStandings(teams, matches)
  const finished = matches.filter((m) => m.status === 'finished').length
  return (
    <>
      <div className="card table-wrap">
        <table className="standings">
          <thead>
            <tr>
              <th>#</th>
              <th className="left">Команда</th>
              <th>И</th>
              <th>В</th>
              <th>Н</th>
              <th>П</th>
              <th>Мячи</th>
              <th>О</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.team.id}>
                <td>
                  <span className={`place ${i === 0 && finished > 0 ? 'place-1' : ''}`}>{i + 1}</span>
                </td>
                <td className="left">
                  <span className="team-cell">
                    <TeamBadge color={r.team.color} />
                    <span className="team-cell-name">{r.team.name}</span>
                  </span>
                  {r.form.length > 0 && (
                    <span className="form-chips">
                      {r.form.slice(-5).map((f, k) => (
                        <span key={k} className={`form-${f}`}>
                          {f === 'W' ? 'В' : f === 'D' ? 'Н' : 'П'}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td>{r.played}</td>
                <td>{r.won}</td>
                <td>{r.drawn}</td>
                <td>{r.lost}</td>
                <td className="nowrap">
                  {r.gf}:{r.ga}
                </td>
                <td className="pts">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Учитываются завершённые матчи. Порядок мест: очки → разница мячей → личные встречи → забитые мячи.</p>
    </>
  )
}

type SortKey = 'goals' | 'assists' | 'ga' | 'titles' | 'mvp' | 'matches' | 'cards' | 'gk'

const TOURNAMENT_SORTS: { value: SortKey; label: string }[] = [
  { value: 'goals', label: 'Голы' },
  { value: 'assists', label: 'Пасы' },
  { value: 'ga', label: 'Г+П' },
  { value: 'cards', label: 'Карт.' },
  { value: 'gk', label: 'Вратари' },
]

const SERIES_SORTS: { value: SortKey; label: string }[] = [
  { value: 'goals', label: 'Голы' },
  { value: 'assists', label: 'Пасы' },
  { value: 'ga', label: 'Г+П' },
  { value: 'titles', label: '🏆' },
  { value: 'mvp', label: '⭐' },
  { value: 'matches', label: 'Матчи' },
  { value: 'gk', label: 'Вратари' },
]

/** Строка таблицы: статистика игрока в турнире (team_id) или суммарно по серии (tournaments). */
export type StatsRow = PlayerStats & { team_id?: string; tournaments?: number }

/**
 * Таблица игроков. mode="tournament" — с командой игрока; mode="series" — без команды
 * (игроки переходят из команды в команду), но с числом турниров, титулами и MVP турниров.
 */
export function PlayersStatsTable({
  stats,
  players,
  teams,
  mode = 'tournament',
}: {
  stats: StatsRow[]
  players: Map<string, Pick<Player, 'id' | 'first_name' | 'last_name' | 'photo_url'>>
  teams?: Map<string, TournamentTeam>
  mode?: 'tournament' | 'series'
}) {
  const [sort, setSort] = useState<SortKey>('goals')
  const isSeries = mode === 'series'

  const rows = useMemo(() => {
    const value = (s: StatsRow) => {
      switch (sort) {
        case 'goals': return s.goals
        case 'assists': return s.assists
        case 'ga': return s.goals + s.assists
        case 'titles': return s.titles
        case 'mvp': return s.mvp
        case 'matches': return s.matches
        case 'cards': return s.red_cards * 2 + s.yellow_cards
        case 'gk': return s.clean_sheets
      }
    }
    const list = stats.filter((s) => (sort === 'gk' ? s.gk_matches > 0 : value(s) > 0))
    return list.sort((a, b) => value(b) - value(a) || a.matches - b.matches || b.goals + b.assists - (a.goals + a.assists))
  }, [stats, sort])

  const hi = (...keys: SortKey[]) => (keys.includes(sort) ? 'pts' : '')

  return (
    <>
      <div className="sort-scroll">
        <Segmented<SortKey> value={sort} onChange={setSort} options={isSeries ? SERIES_SORTS : TOURNAMENT_SORTS} />
      </div>
      {rows.length === 0 ? (
        <div className="card state">{sort === 'gk' ? 'Вратари в матчах пока не отмечены' : 'Пока пусто — здесь появятся игроки после первых событий матчей'}</div>
      ) : (
        <div className="card table-wrap">
          <table className="standings players-table">
            <thead>
              <tr>
                <th>#</th>
                <th className="left">Игрок</th>
                {isSeries && <th>Т</th>}
                <th>И</th>
                {sort === 'gk' ? (
                  <>
                    <th>Сух</th>
                    <th>Проп</th>
                  </>
                ) : isSeries ? (
                  <>
                    <th>Г</th>
                    <th>П</th>
                    <th>🏆</th>
                    <th>⭐</th>
                  </>
                ) : (
                  <>
                    <th>Г</th>
                    <th>П</th>
                    <th>🟨</th>
                    <th>🟥</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => {
                const p = players.get(s.player_id)
                const team = s.team_id ? teams?.get(s.team_id) : undefined
                const name = p ? fullName(p) : '—'
                return (
                  <tr key={s.player_id}>
                    <td>{i + 1}</td>
                    <td className="left">
                      <Link to={`/players/${s.player_id}`} className="team-cell">
                        <Avatar src={p?.photo_url} name={name} size={26} />
                        <span className="player-cell">
                          <span className="team-cell-name">{name}</span>
                          {team && (
                            <span className="player-cell-team">
                              <TeamBadge color={team.color} size={8} /> {team.name}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    {isSeries && <td>{s.tournaments ?? 0}</td>}
                    <td className={hi('matches')}>{s.matches}</td>
                    {sort === 'gk' ? (
                      <>
                        <td className="pts">{s.clean_sheets}</td>
                        <td>{s.goals_conceded}</td>
                      </>
                    ) : isSeries ? (
                      <>
                        <td className={hi('goals', 'ga')}>{s.goals}</td>
                        <td className={hi('assists', 'ga')}>{s.assists}</td>
                        <td className={hi('titles')}>{s.titles}</td>
                        <td className={hi('mvp')}>{s.mvp}</td>
                      </>
                    ) : (
                      <>
                        <td className={hi('goals', 'ga')}>{s.goals}</td>
                        <td className={hi('assists', 'ga')}>{s.assists}</td>
                        <td>{s.yellow_cards}</td>
                        <td>{s.red_cards}</td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}
