import { computeStandings } from './standings'
import type { Match, PlayerTournamentStats, Tournament, TournamentTeam } from './types'

/** Очки серии за место команды игрока в турнире. */
export const PLACE_POINTS: Record<number, number> = { 1: 3, 2: 2, 3: 1 }

export interface SeriesPointsRow {
  player_id: string
  points: number
  /** сколько завершённых турниров серии сыграл */
  tournaments: number
  first: number
  second: number
  third: number
}

/**
 * Место каждой команды в завершённых турнирах (teamId → место).
 * 1-е место — сохранённый победитель турнира, остальные — по итоговой таблице.
 */
export function finalPlaces(tournaments: Tournament[], teams: TournamentTeam[], matches: Match[]): Map<string, number> {
  const places = new Map<string, number>()
  for (const t of tournaments) {
    if (t.status !== 'finished') continue
    const order = computeStandings(
      teams.filter((x) => x.tournament_id === t.id),
      matches.filter((m) => m.tournament_id === t.id),
    ).map((r) => r.team.id)
    if (t.winner_team_id && order[0] !== t.winner_team_id) {
      order.splice(order.indexOf(t.winner_team_id), 1)
      order.unshift(t.winner_team_id)
    }
    order.forEach((teamId, i) => places.set(teamId, i + 1))
  }
  return places
}

/** Очки серии по игрокам: учитываются только завершённые турниры. */
export function seriesPoints(stats: PlayerTournamentStats[], places: Map<string, number>): SeriesPointsRow[] {
  const by = new Map<string, SeriesPointsRow>()
  for (const s of stats) {
    if (s.tournament_status !== 'finished') continue
    const row = by.get(s.player_id) ?? { player_id: s.player_id, points: 0, tournaments: 0, first: 0, second: 0, third: 0 }
    const place = places.get(s.team_id)
    row.tournaments++
    row.points += (place && PLACE_POINTS[place]) || 0
    if (place === 1) row.first++
    if (place === 2) row.second++
    if (place === 3) row.third++
    by.set(s.player_id, row)
  }
  return [...by.values()]
}
